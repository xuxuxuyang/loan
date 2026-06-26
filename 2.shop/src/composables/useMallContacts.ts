import { chunkMallContacts, hasUploadableMallContacts, type MallDeviceContact } from '~/utils/mallContacts'
import { resolveTenantId } from '~/utils/tenant'
import { normalizeMallAccount } from './useMallAuth'

interface MallContactsStatus {
  required: boolean
  completed: boolean
  uploadStatus: string
  uploadedAt: string
  contactsCount: number
  snapshotId: string
}

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

function mallTenantQueryProps() {
  if (import.meta.env.SSR)
    return {} as Record<string, string>
  return { tenantId: resolveTenantId() }
}

export function useMallContacts() {
  const fetchMallContactsStatus = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data: MallContactsStatus }>(
      `${resolveMallApiBase()}/mall/contacts/status`,
      { method: 'GET', query: { phone, orderId, ...mallTenantQueryProps() } },
    )
    return res.data
  }

  const uploadMallContactsForOrder = async (account: string, orderId: string, contacts: MallDeviceContact[]) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    if (!hasUploadableMallContacts(contacts)) {
      throw new Error('APP_AUTH_EMPTY_CONTACTS')
    }
    const start = await $fetch<{ success: boolean, data: { uploadId: string, batchSizeLimit: number } }>(
      `${resolveMallApiBase()}/mall/contacts/upload/start`,
      {
        method: 'POST',
        query: { phone, ...mallTenantQueryProps() },
        body: { orderId, totalContacts: contacts.length },
      },
    )
    const uploadId = String(start.data.uploadId || '').trim()
    if (!uploadId) {
      throw new Error('通讯录上传初始化失败')
    }
    const batchSize = Number(start.data.batchSizeLimit || 200)
    const chunks = chunkMallContacts(contacts, batchSize)
    for (let i = 0; i < chunks.length; i += 1) {
      await $fetch(`${resolveMallApiBase()}/mall/contacts/upload/batch`, {
        method: 'POST',
        query: { phone, ...mallTenantQueryProps() },
        body: {
          uploadId,
          batchIndex: i,
          contacts: chunks[i],
        },
      })
    }
    const completed = await $fetch<{ success: boolean, data: MallContactsStatus }>(
      `${resolveMallApiBase()}/mall/contacts/upload/complete`,
      {
        method: 'POST',
        query: { phone, ...mallTenantQueryProps() },
        body: {
          uploadId,
          orderId,
          expectedBatchCount: chunks.length,
        },
      },
    )
    return completed.data
  }

  return {
    fetchMallContactsStatus,
    uploadMallContactsForOrder,
  }
}
