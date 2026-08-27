const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const cors = require('@koa/cors')
const Router = require('@koa/router')
const Koa = require('koa')

const { app } = require('../src/index')
const { createAdminLoginPreflightGuard } = require('../src/adminLoginPreflight')

function request(server, method, requestPath, headers = {}) {
  const address = server.address()
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: requestPath,
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body = null
        try {
          body = text ? JSON.parse(text) : null
        }
        catch {
          body = text
        }
        resolve({ status: response.statusCode, headers: response.headers, body })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function withServer(application, run) {
  const server = application.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    await run(server)
  }
  finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

async function withProductionServer(run) {
  return withServer(app, run)
}

function preflightHeaders(origin, requestedMethod) {
  return {
    origin,
    'access-control-request-method': requestedMethod,
    'access-control-request-headers': 'authorization,content-type',
  }
}

function assertRejectedPreflight(response, expectedStatus) {
  assert.equal(response.status, expectedStatus)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
}

test('real production app allows only registered browser preflights across the admin trust boundary', async () => {
  const originalMode = process.env.ADMIN_LOGIN_SMS_MODE
  const originalOrigin = process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
  const trustedOrigin = 'https://trusted-admin.example.test'
  const publicOrigin = 'https://shopper.example.test'
  process.env.ADMIN_LOGIN_SMS_MODE = 'enforce'
  process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = trustedOrigin

  try {
    await withProductionServer(async (server) => {
      const unknown = await request(
        server,
        'OPTIONS',
        '/api/future-admin-report',
        preflightHeaders(trustedOrigin, 'GET'),
      )
      assertRejectedPreflight(unknown, 404)

      for (const requestPath of ['/api/admin/profile', '/api/future-admin-report']) {
        const nonBrowserOptions = await request(server, 'OPTIONS', requestPath, {
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,content-type',
        })
        assertRejectedPreflight(nonBrowserOptions, 401)
        assert.equal(nonBrowserOptions.body.code, 'ADMIN_LOGIN_SESSION_INVALID')
      }

      for (const [requestPath, requestedMethod] of [
        ['/api/admin/login', 'POST'],
        ['/api/admin/profile', 'GET'],
      ]) {
        const response = await request(server, 'OPTIONS', requestPath, preflightHeaders(trustedOrigin, requestedMethod))
        assert.equal(response.status, 204, `${requestedMethod} ${requestPath}`)
        assert.equal(response.headers['access-control-allow-origin'], trustedOrigin, `${requestedMethod} ${requestPath}`)
        assert.match(response.headers['access-control-allow-methods'] || '', new RegExp(requestedMethod))
        assert.equal(response.headers['access-control-allow-headers'], 'authorization,content-type')
      }

      const publicBusiness = await request(
        server,
        'OPTIONS',
        '/api/products',
        preflightHeaders(publicOrigin, 'GET'),
      )
      assert.equal(publicBusiness.status, 204)
      assert.equal(publicBusiness.headers['access-control-allow-origin'], '*')

      for (const [requestPath, requestedMethod] of [
        ['/api/ios/admin/export', 'GET'],
        ['/api/payment/lakala/admin/refund-all', 'POST'],
      ]) {
        const response = await request(server, 'OPTIONS', requestPath, preflightHeaders(publicOrigin, requestedMethod))
        assertRejectedPreflight(response, 404)
      }

      const untrustedAdmin = await request(
        server,
        'OPTIONS',
        '/api/admin/profile',
        preflightHeaders(publicOrigin, 'GET'),
      )
      assertRejectedPreflight(untrustedAdmin, 403)

      for (const origin of [trustedOrigin, publicOrigin]) {
        for (const [method, requestPath] of [
          ['GET', '/api/future-admin-report'],
          ['POST', '/api/health'],
          ['GET', '/api/ios/admin/export'],
          ['POST', '/api/payment/lakala/admin/refund-all'],
        ]) {
          const response = await request(server, method, requestPath, { origin })
          assert.equal(response.status, 401, `${origin} ${method} ${requestPath}`)
          assert.equal(response.body.code, 'ADMIN_LOGIN_SESSION_INVALID', `${origin} ${method} ${requestPath}`)
          assert.equal(response.headers['access-control-allow-origin'], undefined, `${origin} ${method} ${requestPath}`)
        }

        const expectedAdminOrigin = origin === trustedOrigin ? trustedOrigin : undefined
        for (const [method, requestPath] of [
          ['POST', '/api/admin/login'],
          ['GET', '/api/admin/profile'],
        ]) {
          const response = await request(server, method, requestPath, { origin })
          assert.equal(response.status, 401, `${origin} ${method} ${requestPath}`)
          assert.equal(response.headers['access-control-allow-origin'], expectedAdminOrigin, `${origin} ${method} ${requestPath}`)
        }

        const publicBusinessRequest = await request(server, 'GET', '/api/health', { origin })
        assert.equal(publicBusinessRequest.status, 200, origin)
        assert.equal(publicBusinessRequest.headers['access-control-allow-origin'], '*', origin)

        for (const requestPath of [
          '/static/contracts/card-package-claim-template.pdf',
          '/api/static/contracts/card-package-claim-template.pdf',
        ]) {
          const staticResponse = await request(server, 'GET', requestPath, { origin })
          assert.equal(staticResponse.status, 200, `${origin} GET ${requestPath}`)
          assert.equal(staticResponse.headers['access-control-allow-origin'], '*', `${origin} GET ${requestPath}`)
        }
      }
    })
  }
  finally {
    if (originalMode === undefined) delete process.env.ADMIN_LOGIN_SMS_MODE
    else process.env.ADMIN_LOGIN_SMS_MODE = originalMode
    if (originalOrigin === undefined) delete process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
    else process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = originalOrigin
  }
})

test('real production app exposes mounted static routes only for GET and HEAD CORS requests', async () => {
  const publicOrigin = 'https://shopper.example.test'

  await withProductionServer(async (server) => {
    for (const requestPath of [
      '/static/contracts/card-package-claim-template.pdf',
      '/api/static/contracts/card-package-claim-template.pdf',
    ]) {
      for (const requestedMethod of ['GET', 'HEAD']) {
        const response = await request(
          server,
          'OPTIONS',
          requestPath,
          preflightHeaders(publicOrigin, requestedMethod),
        )
        assert.equal(response.status, 204, `${requestedMethod} ${requestPath}`)
        assert.equal(response.headers['access-control-allow-origin'], '*', `${requestedMethod} ${requestPath}`)
        assert.match(response.headers['access-control-allow-methods'] || '', new RegExp(requestedMethod))
        assert.equal(response.headers['access-control-allow-headers'], 'authorization,content-type')

        const actualResponse = await request(server, requestedMethod, requestPath, { origin: publicOrigin })
        assert.equal(actualResponse.status, 200, `${requestedMethod} ${requestPath}`)
        assert.equal(actualResponse.headers['access-control-allow-origin'], '*', `${requestedMethod} ${requestPath}`)
      }

      const writePreflight = await request(server, 'OPTIONS', requestPath, preflightHeaders(publicOrigin, 'POST'))
      assertRejectedPreflight(writePreflight, 404)

      const actualWrite = await request(server, 'POST', requestPath, { origin: publicOrigin })
      assert.equal(actualWrite.headers['access-control-allow-origin'], undefined, `POST ${requestPath}`)
    }
  })
})

test('actual and preflight CORS agree when Router and mounted inventories overlap', async () => {
  const trustedOrigin = 'https://trusted-admin.example.test'
  const publicOrigin = 'https://shopper.example.test'
  const application = new Koa()
  const router = new Router()
  const mountedRoutes = [{ methods: ['GET', 'HEAD'], path: /^\/api\/static\// }]
  const routePolicy = {
    isAdminLoginPublicRequest: () => false,
    isAdminProtectedRequest: (_method, pathValue) => pathValue.startsWith('/api/'),
  }

  router.post('/api/static/upload', (ctx) => {
    ctx.body = { success: true }
  })
  application.use(createAdminLoginPreflightGuard({
    routers: [router],
    mountedRoutes,
    routePolicy,
    resolveMode: () => 'enforce',
    resolveTrustedOrigin: () => trustedOrigin,
  }))
  application.use(cors({
    origin: (ctx) => {
      if (!ctx.get('Origin')) return ''
      if (ctx.state.adminLoginCorsRestricted) return ctx.state.adminLoginCorsOrigin || ''
      return '*'
    },
  }))
  application.use(router.routes())

  await withServer(application, async (server) => {
    const preflight = await request(
      server,
      'OPTIONS',
      '/api/static/upload',
      preflightHeaders(trustedOrigin, 'POST'),
    )
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], trustedOrigin)

    const trustedActual = await request(server, 'POST', '/api/static/upload', { origin: trustedOrigin })
    assert.equal(trustedActual.status, 200)
    assert.equal(trustedActual.headers['access-control-allow-origin'], trustedOrigin)

    const untrustedActual = await request(server, 'POST', '/api/static/upload', { origin: publicOrigin })
    assert.equal(untrustedActual.status, 200)
    assert.equal(untrustedActual.headers['access-control-allow-origin'], undefined)
  })
})

test('real production app fails admin preflight closed for invalid origin config in every mode', async () => {
  const originalMode = process.env.ADMIN_LOGIN_SMS_MODE
  const originalOrigin = process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
  const trustedOrigin = 'https://trusted-admin.example.test'

  try {
    await withProductionServer(async (server) => {
      for (const invalidOrigin of [
        '',
        '*',
        'not-an-origin',
        'ftp://trusted-admin.example.test',
        'https://trusted-admin.example.test/',
        'https://trusted-admin.example.test/path',
        'https://trusted-admin.example.test?debug=1',
        'https://trusted-admin.example.test#debug',
        'https://user:password@trusted-admin.example.test',
      ]) {
        process.env.ADMIN_LOGIN_SMS_MODE = 'enforce'
        process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = invalidOrigin
        const response = await request(
          server,
          'OPTIONS',
          '/api/admin/login',
          preflightHeaders(trustedOrigin, 'POST'),
        )
        assertRejectedPreflight(response, 503)
      }

      for (const mode of ['off', 'audit']) {
        process.env.ADMIN_LOGIN_SMS_MODE = mode
        delete process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
        const adminResponse = await request(
          server,
          'OPTIONS',
          '/api/admin/login',
          preflightHeaders(trustedOrigin, 'POST'),
        )
        assertRejectedPreflight(adminResponse, 403)

        const publicResponse = await request(
          server,
          'OPTIONS',
          '/api/products',
          preflightHeaders('https://shopper.example.test', 'GET'),
        )
        assert.equal(publicResponse.status, 204)
        assert.equal(publicResponse.headers['access-control-allow-origin'], '*')
      }

      process.env.ADMIN_LOGIN_SMS_MODE = 'unexpected'
      process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = trustedOrigin
      const invalidModeConfiguredResponse = await request(
        server,
        'OPTIONS',
        '/api/admin/login',
        preflightHeaders(trustedOrigin, 'POST'),
      )
      assertRejectedPreflight(invalidModeConfiguredResponse, 503)

      delete process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
      const invalidModeResponse = await request(
        server,
        'OPTIONS',
        '/api/admin/login',
        preflightHeaders(trustedOrigin, 'POST'),
      )
      assertRejectedPreflight(invalidModeResponse, 503)
    })
  }
  finally {
    if (originalMode === undefined) delete process.env.ADMIN_LOGIN_SMS_MODE
    else process.env.ADMIN_LOGIN_SMS_MODE = originalMode
    if (originalOrigin === undefined) delete process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
    else process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = originalOrigin
  }
})
