const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const checker = require('./check-mojibake.js')

test('detects high-confidence mojibake in project text files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojibake-project-'))
  fs.mkdirSync(path.join(dir, '1.api'), { recursive: true })
  fs.writeFileSync(path.join(dir, '1.api', '.env.production'), 'MSG=????\n', 'utf8')

  const result = checker.scanProject(dir)

  assert.equal(result.ok, false)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].relativePath, path.join('1.api', '.env.production'))
  assert.equal(result.findings[0].line, 1)
})

test('ignores legitimate question marks and skipped generated directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojibake-project-'))
  fs.mkdirSync(path.join(dir, '1.api', 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(dir, '2.shop', 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, '2.shop', 'src', 'ok.ts'), 'const url = "/?channel=duodiandian"\nconst x = a ? b : c\n', 'utf8')
  fs.writeFileSync(path.join(dir, '1.api', 'node_modules', 'bad.js'), 'MSG=????\n', 'utf8')

  const result = checker.scanProject(dir)

  assert.equal(result.ok, true)
  assert.deepEqual(result.findings, [])
})
