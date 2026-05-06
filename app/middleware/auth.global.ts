/**
 * @name 全局路由中间件
 * @description 在路由变化时执行
 */
export default defineNuxtRouteMiddleware(() => {
  // 按产品需求：用户可直接浏览页面；
  // 仅在点击“购买/下单”时，通过 ensureRegistered() 触发登录校验流程。
})
