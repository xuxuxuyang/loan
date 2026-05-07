<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  billSummary,
  bills: billList,
  fetchBills,
} = useMallMy()
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

const summaryItems = computed(() => [
  { label: '本月应还', value: `￥${billSummary.value.shouldRepay.toFixed(2)}` },
  { label: '可用额度', value: `￥${billSummary.value.availableQuota.toFixed(2)}` },
  { label: '账单日', value: billSummary.value.billDate },
  { label: '最低还款', value: `￥${billSummary.value.minRepayment.toFixed(2)}` },
])
async function goBack() {
  await smartNavigate('/my')
}

function displayAmount(amount: number) {
  const abs = Math.abs(amount).toFixed(2)
  return `${amount >= 0 ? '+' : '-'}￥${abs}`
}

function billStatusClass(status: string) {
  return status === '待还款'
    ? 'border-[#f4c66a] bg-[#fff7e8] text-[#b7791f]'
    : 'border-[#9fd8b9] bg-[#edf9f1] text-[#1f8a4c]'
}

function billStatusDotClass(status: string) {
  return status === '待还款'
    ? 'bg-[#f59e0b]'
    : 'bg-[#22a35a]'
}

function extractOrderId(title: string) {
  const match = String(title || '').match(/#([A-Z0-9]+)/i)
  return match?.[1] || ''
}

function extractOrderTitle(title: string) {
  return String(title || '')
    .replace(/\s*第\d+期\s*#[A-Z0-9]+$/i, '')
    .replace(/\s*#[A-Z0-9]+$/i, '')
    .trim() || '订单账单'
}

function extractPeriod(title: string) {
  const match = String(title || '').match(/第(\d+)期/)
  return match ? Number(match[1]) : 0
}

const groupedBills = computed(() => {
  const groups = new Map<string, {
    key: string
    orderId: string
    orderTitle: string
    latestTime: string
    pendingCount: number
    records: Array<typeof billList.value[number] & { period: number }>
  }>()

  billList.value.forEach((item) => {
    const orderId = extractOrderId(item.title)
    const key = orderId || `bill-${item.id}`
    const group = groups.get(key) || {
      key,
      orderId,
      orderTitle: extractOrderTitle(item.title),
      latestTime: item.time,
      pendingCount: 0,
      records: [],
    }
    group.records.push({
      ...item,
      period: extractPeriod(item.title),
    })
    if (item.status === '待还款') {
      group.pendingCount += 1
    }
    if (String(item.time) > String(group.latestTime)) {
      group.latestTime = item.time
    }
    groups.set(key, group)
  })

  return [...groups.values()]
    .map(group => ({
      ...group,
      records: group.records.sort((a, b) => String(b.time).localeCompare(String(a.time))),
    }))
    .sort((a, b) => String(b.latestTime).localeCompare(String(a.latestTime)))
})

/** 折叠时每组最多预览条数 */
const BILL_PREVIEW_COUNT = 2
const expandedBillGroups = ref<Record<string, boolean>>({})

function isBillGroupExpanded(key: string) {
  return !!expandedBillGroups.value[key]
}

function toggleBillGroupExpand(key: string) {
  expandedBillGroups.value = {
    ...expandedBillGroups.value,
    [key]: !expandedBillGroups.value[key],
  }
}

function recordsToPreview(group: (typeof groupedBills.value)[number]) {
  const { records, key } = group
  if (records.length <= BILL_PREVIEW_COUNT) {
    return records
  }
  if (isBillGroupExpanded(key)) {
    return records
  }
  return records.slice(0, BILL_PREVIEW_COUNT)
}

function showBillExpandControl(group: (typeof groupedBills.value)[number]) {
  return group.records.length > BILL_PREVIEW_COUNT
}

watch(currentUserAccount, async (account) => {
  expandedBillGroups.value = {}
  if (!account) {
    billList.value = []
    return
  }
  await fetchBills(account)
}, { immediate: true })

if (import.meta.client) {
  onMounted(() => {
    void syncFromStorage()
  })
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-7">
    <div class="app-content max-w-[920px]">
      <div class="mb-5 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm text-black/65"
          @click="goBack"
        >
          <Icon
            name="tabler:chevron-left"
            size="1rem"
          />
          返回我的
        </button>
        <h1 class="text-3xl font-semibold text-black/85">
          账单
        </h1>
        <div class="w-[106px]" />
      </div>

      <div class="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article
          v-for="item in summaryItems"
          :key="item.label"
          class="rounded-2xl bg-white p-4"
        >
          <p class="mb-2 text-sm text-black/50">
            {{ item.label }}
          </p>
          <p class="text-xl font-semibold text-black/80">
            {{ item.value }}
          </p>
        </article>
      </div>

      <div class="rounded-3xl bg-white p-6">
        <h2 class="mb-4 text-2xl font-semibold text-black/85">
          账单明细
        </h2>
        <div class="space-y-3">
          <article
            v-for="group in groupedBills"
            :key="group.key"
            class="rounded-2xl bg-[#f7f8fb] px-4 py-3"
          >
            <div class="mb-3 flex items-center justify-between">
              <p class="text-base font-semibold text-black/85">
                {{ group.orderTitle }}
              </p>
              <span class="text-xs text-black/45">
                {{ group.orderId ? `#${group.orderId}` : '未关联订单' }}
              </span>
            </div>
            <div class="mb-3 flex items-center justify-between text-sm text-black/45">
              <span>分期 {{ group.records.length }} 笔</span>
              <span>待还 {{ group.pendingCount }} 笔</span>
            </div>
            <div class="space-y-2">
              <div
                v-for="record in recordsToPreview(group)"
                :key="record.id"
                class="rounded-xl bg-white/70 px-3 py-2.5"
              >
                <div class="mb-1 flex items-center justify-between">
                  <p class="text-sm text-black/70">
                    {{ record.period ? `第${record.period}期` : '账单记录' }}
                  </p>
                  <p class="text-base font-semibold" :class="record.amount >= 0 ? 'text-[#0f8b6f]' : 'text-[#d45a33]'">
                    {{ displayAmount(record.amount) }}
                  </p>
                </div>
                <div class="flex items-center justify-between text-sm text-black/45">
                  <span>{{ record.time }}</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none"
                    :class="billStatusClass(record.status)"
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="billStatusDotClass(record.status)"
                    />
                    {{ record.status }}
                  </span>
                </div>
              </div>
              <button
                v-if="showBillExpandControl(group)"
                type="button"
                class="mt-1 flex w-full items-center justify-center gap-1 rounded-xl border border-black/[0.06] bg-white/50 py-2.5 text-sm font-medium text-[#e87b8f] transition hover:bg-white/90 active:opacity-80"
                @click="toggleBillGroupExpand(group.key)"
              >
                <span>{{ isBillGroupExpanded(group.key) ? '收起明细' : `展开全部明细（${group.records.length} 笔）` }}</span>
                <Icon
                  :name="isBillGroupExpanded(group.key) ? 'tabler:chevron-up' : 'tabler:chevron-down'"
                  size="1rem"
                />
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
