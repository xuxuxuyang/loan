/**
 * 打印聚合收银台下单报文（与线上下单逻辑一致，配置仅读 api/.env.*）
 * 用法：cd api && node scripts/lakala-print-counter-request.js
 */
const path = require('node:path')
require('../src/loadEnv').loadDotenvExports(path.join(__dirname, '../src'))

const lakala = require('../src/payment/lakalaClient')

async function main() {
  const outOrderNo = `LP${Date.now()}`
  const reqData = lakala.buildCounterOrderReqData({
    outOrderNo,
    totalAmountYuan: 0.01,
    orderInfo: '报文核对',
  })
  const body = {
    req_time: lakala.formatReqTime(),
    version: '3.0',
    req_data: reqData,
  }

  console.log('=== 当前 env 开关 ===')
  console.log('  LAKALA_COUNTER_SEND_TERM_NO:', lakala.readEnvTrim('LAKALA_COUNTER_SEND_TERM_NO') || '(空)', '→', lakala.shouldSendCounterTermNo() ? '会上送 term_no' : '不上送 term_no')
  console.log('  LAKALA_COUNTER_PAY_MODE:', lakala.readEnvTrim('LAKALA_COUNTER_PAY_MODE') || '(空)')
  console.log('  LAKALA_PAY_DEBUG:', lakala.readEnvTrim('LAKALA_PAY_DEBUG') || '(空)')

  console.log('\n=== special_create 请求体 ===\n')
  console.log(JSON.stringify(body, null, 2))

  console.log('\n=== 门店/终端相关字段 ===')
  for (const k of ['term_no', 'vpos_id', 'store_id', 'shop_name', 'store_no']) {
    console.log(`  ${k}:`, reqData[k] !== undefined ? reqData[k] : '(未传)')
  }

  console.log('\n=== 实调响应 ===\n')
  try {
    const respData = await lakala.createCounterOrder({
      outOrderNo,
      totalAmountYuan: 0.01,
      orderInfo: '报文核对',
    })
    console.log(JSON.stringify(respData, null, 2))
  }
  catch (e) {
    console.error('下单失败:', e.message, e.lakalaCode || '')
  }
}

main()
