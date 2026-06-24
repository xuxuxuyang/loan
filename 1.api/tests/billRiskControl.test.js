const assert = require('node:assert/strict')
const test = require('node:test')

const { buildBillRiskCustomerView } = require('../src/billRiskControl')

test('builds a customer-safe bill risk upload link view without report data', () => {
  const view = buildBillRiskCustomerView(
    {
      billRiskControl: {
        flowId: 'flow-user-001',
        email: 'customer@mail68.cn',
        lastGeneratedAt: '2026-06-24T09:22:00.000Z',
        reports: [
          {
            name: '张三',
            idcard: '330000199901011234',
            reportURL: 'https://example.com/report',
          },
        ],
      },
    },
    {
      processPageUrl: 'https://flow-process.699e.cn/billProcess',
      backUrl: 'https://wenshuosc.com/bill-risk-result?1=1',
      processType: 'h5',
    },
  )

  assert.equal(view.generated, true)
  assert.equal(view.lastGeneratedAt, '2026-06-24T09:22:00.000Z')
  assert.match(view.guideUrl, /^https:\/\/flow-process\.699e\.cn\/billProcess\?/)
  assert.match(view.guideUrl, /flowId=flow-user-001/)
  assert.match(view.guideUrl, /type=h5/)
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'reports'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'email'), false)
})

test('returns an empty customer view when no bill risk flow has been generated', () => {
  const view = buildBillRiskCustomerView(
    { billRiskControl: {} },
    {
      processPageUrl: 'https://flow-process.699e.cn/billProcess',
      backUrl: 'https://wenshuosc.com/bill-risk-result?1=1',
      processType: 'h5',
    },
  )

  assert.equal(view.generated, false)
  assert.equal(view.guideUrl, '')
  assert.equal(view.lastGeneratedAt, '')
})
