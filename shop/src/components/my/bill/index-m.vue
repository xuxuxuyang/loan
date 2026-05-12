<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  bills: billList,
  fetchBills,
} = useMallMy()
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

/** 全部待还本金合计（与列表中「待还款」一致） */
const pendingRepayTotal = computed(() =>
  billList.value
    .filter(item => item.status === '待还款')
    .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0),
)

/** 账单时间仅展示日期（YYYY-MM-DD） */
function formatBillDateOnly(raw: string) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : s
}

/** 最近一笔待还的到期日 */
const repayDeadlineText = computed(() => {
  const pending = billList.value.filter(item => item.status === '待还款')
  if (!pending.length) {
    return '暂无'
  }
  const sorted = [...pending].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  const t = sorted[0]?.time
  return t ? formatBillDateOnly(t) : '暂无'
})

const billItems = computed(() => [
  { label: '待还金额', value: `￥${pendingRepayTotal.value.toFixed(2)}` },
  { label: '还款到期日', value: repayDeadlineText.value },
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

if (!import.meta.env.SSR) {
  onMounted(() => {
    void syncFromStorage()
  })
}
</script>

<template>
  <section class="px-4 pb-5 pt-4">
    <div class="mb-3 flex items-center justify-between">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black/60"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="text-xl font-semibold text-black/85">
        账单
      </h1>
      <div class="w-9" />
    </div>

    <div class="mb-3 rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        账单概览
      </h2>
      <div class="space-y-2">
        <div
          v-for="item in billItems"
          :key="item.label"
          class="flex items-center justify-between rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <span class="text-sm text-black/55">{{ item.label }}</span>
          <span class="text-sm font-semibold text-black/80">{{ item.value }}</span>
        </div>
      </div>
    </div>

    <div class="rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        最近记录
      </h2>
      <div class="space-y-2.5">
        <article
          v-for="group in groupedBills"
          :key="group.key"
          class="rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <div class="mb-2 flex items-center justify-between">
            <p class="line-clamp-1 text-sm font-semibold text-black/85">
              {{ group.orderTitle }}
            </p>
            <span class="text-xs text-black/45">
              {{ group.orderId ? `#${group.orderId}` : '未关联订单' }}
            </span>
          </div>

          <div class="mb-2 flex items-center justify-between text-xs text-black/45">
            <span>先享后付 {{ group.records.length }} 笔</span>
            <span>待还 {{ group.pendingCount }} 笔</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="record in recordsToPreview(group)"
              :key="record.id"
              class="rounded-lg bg-white/65 px-2.5 py-2"
            >
              <div class="mb-1 flex items-center justify-between">
                <p class="text-sm text-black/70">
                  {{ record.period ? `第${record.period}期` : '账单记录' }}
                </p>
                <p class="text-sm font-semibold" :class="record.amount >= 0 ? 'text-[#0f8b6f]' : 'text-[#d45a33]'">
                  {{ displayAmount(record.amount) }}
                </p>
              </div>
              <div class="flex items-center justify-between text-xs text-black/45">
                <span>{{ formatBillDateOnly(record.time) }}</span>
                <span
                  class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
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
              class="mt-1 flex w-full items-center justify-center gap-0.5 rounded-lg py-2 text-xs font-medium text-[#e87b8f] transition hover:bg-white/50 active:opacity-80"
              @click="toggleBillGroupExpand(group.key)"
            >
              <span>{{ isBillGroupExpanded(group.key) ? '收起' : `展开全部（${group.records.length} 笔）` }}</span>
              <Icon
                :name="isBillGroupExpanded(group.key) ? 'tabler:chevron-up' : 'tabler:chevron-down'"
                size="0.95rem"
              />
            </button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
