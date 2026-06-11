#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.conf', '.css', '.env', '.example', '.html', '.js', '.json', '.md', '.mjs',
  '.ps1', '.sh', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml',
])

const TEXT_FILENAMES = new Set([
  '.env', '.env.development', '.env.production', '.env.example', '.gitignore',
  'nginx.conf', 'package.json', 'package-lock.json',
])

const SKIP_DIRS = new Set([
  '.git', '.nuxt', '.output', '.vite', 'android', 'backups', 'build', 'coverage', 'dist',
  'node_modules', 'platforms', 'plugins', 'www',
])

const MOJIBAKE_PATTERNS = [
  { name: 'question-mark-run', test: line => /\?{3,}/.test(line) },
  { name: 'replacement-char', test: line => line.includes(String.fromCharCode(0xfffd)) },
  // Common UTF-8 Chinese decoded as GBK/Windows-936 fragments. Require a run to avoid normal Chinese false positives.
  { name: 'mojibake-cjk-run', test: line => /[\u9286\u9295\u9359\u93b5\u942d\u9435][\u3400-\u9fff\ue000-\uf8ff]{2,}/u.test(line) },
]

const ALLOWED_FINDINGS = [
  {
    relativePath: path.join('2.shop', 'src', 'components', 'my', 'order', 'MyOrderMobile.vue'),
    includes: "text.includes('" + String.fromCharCode(0xfffd) + "')",
  },
  {
    relativePath: path.join('scripts', 'check-mojibake.test.js'),
    includes: 'MSG=' + '?'.repeat(4),
  },
]

function isSkippedDir(name) {
  return SKIP_DIRS.has(name)
}

function isTextFile(filePath) {
  const base = path.basename(filePath)
  if (TEXT_FILENAMES.has(base)) return true
  if (base.startsWith('.env')) return true
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase())
}

function shouldAllow(relativePath, lineText) {
  return ALLOWED_FINDINGS.some(rule => (
    rule.relativePath === relativePath && lineText.includes(rule.includes)
  ))
}

function walkFiles(rootDir, out = []) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue
      walkFiles(path.join(rootDir, entry.name), out)
      continue
    }
    if (entry.isFile()) {
      const fullPath = path.join(rootDir, entry.name)
      if (isTextFile(fullPath)) out.push(fullPath)
    }
  }
  return out
}

function scanText(text, relativePath) {
  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((lineText, index) => {
    if (shouldAllow(relativePath, lineText)) return
    const matched = MOJIBAKE_PATTERNS.filter(pattern => pattern.test(lineText)).map(pattern => pattern.name)
    if (matched.length) {
      findings.push({
        relativePath,
        line: index + 1,
        patterns: matched,
        text: lineText.slice(0, 240),
      })
    }
  })
  return findings
}

function scanProject(projectRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(projectRoot)
  const findings = []
  const files = walkFiles(root)
  for (const filePath of files) {
    const relativePath = path.relative(root, filePath)
    let text
    try {
      text = fs.readFileSync(filePath, 'utf8')
    }
    catch (error) {
      findings.push({
        relativePath,
        line: 0,
        patterns: ['read-error'],
        text: error && error.message ? error.message : String(error),
      })
      continue
    }
    findings.push(...scanText(text, relativePath))
  }
  return { ok: findings.length === 0, findings, filesScanned: files.length }
}

function formatFinding(finding) {
  const where = finding.line > 0 ? `${finding.relativePath}:${finding.line}` : finding.relativePath
  return `${where} [${finding.patterns.join(', ')}] ${finding.text}`
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..')
  const result = scanProject(root)
  if (!result.ok) {
    console.error(`Mojibake check failed: ${result.findings.length} suspicious line(s), ${result.filesScanned} file(s) scanned.`)
    for (const finding of result.findings.slice(0, 80)) {
      console.error(formatFinding(finding))
    }
    if (result.findings.length > 80) {
      console.error(`... ${result.findings.length - 80} more finding(s) omitted.`)
    }
    process.exitCode = 1
    return
  }
  console.log(`Mojibake check passed: ${result.filesScanned} file(s) scanned.`)
}

module.exports = {
  scanProject,
  scanText,
}

if (require.main === module) {
  main()
}
