function resolveExactHttpOrigin(value) {
  const raw = String(value ?? '')
  if (!raw) return ''

  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return raw === parsed.origin ? raw : ''
  }
  catch {
    return ''
  }
}

function isRegisteredRouterRequest(routers, pathValue, method) {
  return routers.some((router) => {
    if (!router || typeof router.match !== 'function') return false
    return Boolean(router.match(pathValue, method).route)
  })
}

function isRegisteredRequest(routers, mountedRoutes, pathValue, method) {
  if (isRegisteredRouterRequest(routers, pathValue, method)) return true
  return mountedRoutes.some(rule => rule.methods.includes(method) && rule.path.test(pathValue))
}

function isDisallowedMountedRequest(mountedRoutes, pathValue, method) {
  const matchingRules = mountedRoutes.filter(rule => rule.path.test(pathValue))
  return matchingRules.length > 0 && matchingRules.every(rule => !rule.methods.includes(method))
}

function fail(ctx, status, code, message) {
  ctx.status = status
  ctx.body = { success: false, code, msg: message, data: null }
}

function createAdminLoginPreflightGuard(options = {}) {
  const routers = Array.isArray(options.routers) ? options.routers : []
  const mountedRoutes = Array.isArray(options.mountedRoutes) ? options.mountedRoutes : []
  const routePolicy = options.routePolicy
  const resolveMode = options.resolveMode || (() => '')
  const resolveTrustedOrigin = options.resolveTrustedOrigin || (() => '')
  const isAdminRequest = (method, pathValue) => routePolicy.isAdminLoginPublicRequest(method, pathValue)
    || routePolicy.isAdminProtectedRequest(method, pathValue)

  return async function enforceAdminLoginPreflight(ctx, next) {
    const requestOrigin = String(ctx.get('Origin') || '')
    const requestedMethod = String(ctx.get('Access-Control-Request-Method') || '').trim().toUpperCase()
    if (ctx.method !== 'OPTIONS'
      && requestOrigin
      && !isRegisteredRouterRequest(routers, ctx.path, ctx.method)
      && isDisallowedMountedRequest(mountedRoutes, ctx.path, ctx.method)) {
      ctx.state.adminLoginCorsRestricted = true
      await next()
      return
    }
    if (ctx.method !== 'OPTIONS' && requestOrigin && isAdminRequest(ctx.method, ctx.path)) {
      ctx.state.adminLoginCorsRestricted = true
      if (!isRegisteredRequest(routers, mountedRoutes, ctx.path, ctx.method)) {
        await next()
        return
      }
      const trustedOrigin = resolveExactHttpOrigin(resolveTrustedOrigin())
      const mode = String(resolveMode() || '').trim().toLowerCase()
      if (['off', 'audit', 'enforce'].includes(mode) && requestOrigin === trustedOrigin) {
        ctx.state.adminLoginCorsOrigin = trustedOrigin
      }
      await next()
      return
    }

    if (ctx.method !== 'OPTIONS' || !requestOrigin || !requestedMethod) {
      await next()
      return
    }

    if (!isRegisteredRequest(routers, mountedRoutes, ctx.path, requestedMethod)) {
      fail(ctx, 404, 'CORS_ROUTE_NOT_FOUND', '预检请求未命中已注册接口')
      return
    }

    if (!isAdminRequest(requestedMethod, ctx.path)) {
      await next()
      return
    }

    const trustedOrigin = resolveExactHttpOrigin(resolveTrustedOrigin())
    const mode = String(resolveMode() || '').trim().toLowerCase()
    if (!['off', 'audit', 'enforce'].includes(mode)) {
      fail(ctx, 503, 'ADMIN_LOGIN_MODE_UNAVAILABLE', '后台登录短信模式未正确配置')
      return
    }
    if (!trustedOrigin) {
      if (mode === 'off' || mode === 'audit') {
        fail(ctx, 403, 'ADMIN_LOGIN_ORIGIN_FORBIDDEN', '当前来源无权访问后台接口')
      }
      else {
        fail(ctx, 503, 'ADMIN_LOGIN_ORIGIN_UNAVAILABLE', '后台管理端可信来源未正确配置')
      }
      return
    }

    if (requestOrigin !== trustedOrigin) {
      fail(ctx, 403, 'ADMIN_LOGIN_ORIGIN_FORBIDDEN', '当前来源无权访问后台接口')
      return
    }

    ctx.state.adminLoginCorsRestricted = true
    ctx.state.adminLoginCorsOrigin = trustedOrigin
    await next()
  }
}

module.exports = {
  createAdminLoginPreflightGuard,
  resolveExactHttpOrigin,
}
