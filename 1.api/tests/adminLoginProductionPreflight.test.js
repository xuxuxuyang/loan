const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')

const { app } = require('../src/index')

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

async function withProductionServer(run) {
  const server = app.listen(0, '127.0.0.1')
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

      const protectedWithoutSession = await request(server, 'GET', '/api/admin/profile', { origin: trustedOrigin })
      assert.equal(protectedWithoutSession.status, 401)
      assert.equal(protectedWithoutSession.body.code, 'ADMIN_LOGIN_SESSION_INVALID')
      assert.equal(protectedWithoutSession.headers['access-control-allow-origin'], trustedOrigin)

      const untrustedProtectedRequest = await request(server, 'GET', '/api/admin/profile', { origin: publicOrigin })
      assert.equal(untrustedProtectedRequest.status, 401)
      assert.equal(untrustedProtectedRequest.body.code, 'ADMIN_LOGIN_SESSION_INVALID')
      assert.equal(untrustedProtectedRequest.headers['access-control-allow-origin'], undefined)

      const publicBusinessRequest = await request(server, 'GET', '/api/health', { origin: publicOrigin })
      assert.equal(publicBusinessRequest.status, 200)
      assert.equal(publicBusinessRequest.headers['access-control-allow-origin'], '*')
    })
  }
  finally {
    if (originalMode === undefined) delete process.env.ADMIN_LOGIN_SMS_MODE
    else process.env.ADMIN_LOGIN_SMS_MODE = originalMode
    if (originalOrigin === undefined) delete process.env.ADMIN_LOGIN_TRUSTED_ORIGIN
    else process.env.ADMIN_LOGIN_TRUSTED_ORIGIN = originalOrigin
  }
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
