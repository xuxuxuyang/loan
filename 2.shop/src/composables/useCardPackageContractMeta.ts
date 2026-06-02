import type { ComputedRef, Ref } from 'vue'

type ContractPayload = Record<string, unknown> | null

function contractPayloadData(root: ContractPayload) {
  if (!root || typeof root !== 'object') {
    return null
  }
  const data = root.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }
  return data as Record<string, unknown>
}

export function useCardPackageContractMeta(
  contractRoot: Ref<ContractPayload>,
  contractError: Ref<string>,
): {
  contractData: ComputedRef<Record<string, unknown> | null>
  contractShowsSigned: ComputedRef<boolean>
  contractBinaryStatusLabel: ComputedRef<string>
  contractSignUrl: ComputedRef<string>
  contractPreviewUrl: ComputedRef<string>
  contractEmbedUrl: ComputedRef<string>
  showContractUpstreamHint: ComputedRef<boolean>
} {
  const contractData = computed(() => contractPayloadData(contractRoot.value))

  const contractShowsSigned = computed(() => {
    const status = contractData.value?.status
    return String(status ?? '') === '2'
  })

  const contractBinaryStatusLabel = computed(() => {
    return contractShowsSigned.value ? '已签约' : '未签约'
  })

  const contractSignUrl = computed(() => {
    const data = contractData.value
    if (!data) {
      return ''
    }
    const users = Array.isArray(data.signUser) ? (data.signUser as Record<string, unknown>[]) : []
    const first = users.find(user => user && String(user.signUrl || '').trim())
    if (first) {
      return String(first.signUrl).trim()
    }
    return String(data.signUrl || data.sign_url || '').trim()
  })

  const contractPreviewUrl = computed(() => {
    const data = contractData.value
    if (!data) {
      return ''
    }
    return String(data.previewUrl || data.preview_url || data.embeddedUrl || data.embedded_url || '').trim()
  })

  const contractEmbedUrl = computed(() => {
    return contractSignUrl.value || contractPreviewUrl.value
  })

  const showContractUpstreamHint = computed(() => {
    const errorText = contractError.value || ''
    return /签名|签署方|serialNo|signAuthSerialNo|MALL_CARD_PACKAGE/i.test(errorText)
  })

  return {
    contractData,
    contractShowsSigned,
    contractBinaryStatusLabel,
    contractSignUrl,
    contractPreviewUrl,
    contractEmbedUrl,
    showContractUpstreamHint,
  }
}
