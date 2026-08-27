const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')

test('API module exposes the real Koa app and route stacks without starting the listener on require', () => {
  assert.match(source, /if\s*\(require\.main\s*===\s*module\)/)
  assert.match(source, /module\.exports\s*=\s*\{[\s\S]*\bapp\b[\s\S]*\brouter\b[\s\S]*\}/)
})
