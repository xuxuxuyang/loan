import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'src/utils/trafficLead.ts')
const outDir = resolve(root, '.tmp-tests')
const outPath = resolve(outDir, 'trafficLead.mjs')

if (!existsSync(sourcePath)) {
  throw new Error('src/utils/trafficLead.ts is missing')
}

mkdirSync(outDir, { recursive: true })
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
}).outputText
writeFileSync(outPath, compiled, 'utf8')

const mod = await import(pathToFileURL(outPath).href + `?t=${Date.now()}`)
const { shouldShowTrafficCreditLead, createTrafficCreditLeadSessionKey, isAuthRouteForTrafficLead } = mod

assert.equal(typeof shouldShowTrafficCreditLead, 'function')
assert.equal(typeof createTrafficCreditLeadSessionKey, 'function')
assert.equal(typeof isAuthRouteForTrafficLead, 'function')

assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/', sessionShown: false }), true)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/', sessionShown: false, channel: 'abc001' }), true)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/user-agreement', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/privacy-policy', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/product/1', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: true, hasRegisteredMarker: false, routePath: '/', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: true, routePath: '/', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/login', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/register', sessionShown: false }), false)
assert.equal(shouldShowTrafficCreditLead({ isLoggedIn: false, hasRegisteredMarker: false, routePath: '/', sessionShown: true }), false)

assert.equal(isAuthRouteForTrafficLead('/login'), true)
assert.equal(isAuthRouteForTrafficLead('/register'), true)
assert.equal(isAuthRouteForTrafficLead('/product/1'), false)
assert.equal(createTrafficCreditLeadSessionKey(), 'mall_traffic_credit_lead_shown')

rmSync(outDir, { recursive: true, force: true })
console.log('traffic lead tests passed')
