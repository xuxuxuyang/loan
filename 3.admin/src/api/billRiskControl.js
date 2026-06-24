import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

async function readJson(response) {
  return response.json().catch(() => ({}))
}

export async function getBillRiskView(userId) {
  const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(userId)}/bill-risk`, {
    method: 'GET',
    headers: withMallTenantHeaders(),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, '加载流水风控失败'))
  }
  return payload.data
}

export async function generateBillRiskMail(userId) {
  const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(userId)}/bill-risk/mail`, {
    method: 'POST',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, '生成流水风控动态邮箱失败'))
  }
  return payload.data
}
