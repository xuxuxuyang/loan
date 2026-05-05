import { ref } from 'vue'

export interface InstallmentItem {
  period: number
  dueDate: string
  principal: number
  fee: number
  amount: number
  paid: boolean
}

export interface OrderItem {
  id: string
  user: string
  product: string
  totalAmount: number
  periods: number
  periodAmount: number
  currentPeriod: number
  nextRepayDate: string
  status: '待付款' | '待发货' | '待收货' | '已完成'
  createdAt: string
  installmentPlan: InstallmentItem[]
}

function createMockOrders(): OrderItem[] {
  return [
    {
      id: 'ORD-20260505-001',
      user: '张三',
      product: '明前西湖龙井礼盒',
      totalAmount: 1280,
      periods: 6,
      periodAmount: 226.67,
      currentPeriod: 2,
      nextRepayDate: '2026-06-08',
      status: '待发货',
      createdAt: '2026-05-05 09:23',
      installmentPlan: [
        { period: 1, dueDate: '2026-05-08', principal: 213.33, fee: 13.34, amount: 226.67, paid: true },
        { period: 2, dueDate: '2026-06-08', principal: 213.33, fee: 13.34, amount: 226.67, paid: false },
        { period: 3, dueDate: '2026-07-08', principal: 213.33, fee: 13.34, amount: 226.67, paid: false },
        { period: 4, dueDate: '2026-08-08', principal: 213.33, fee: 13.34, amount: 226.67, paid: false },
        { period: 5, dueDate: '2026-09-08', principal: 213.33, fee: 13.34, amount: 226.67, paid: false },
        { period: 6, dueDate: '2026-10-08', principal: 213.35, fee: 13.31, amount: 226.66, paid: false },
      ],
    },
    {
      id: 'ORD-20260505-002',
      user: '李四',
      product: '福鼎白毫银针',
      totalAmount: 1480,
      periods: 12,
      periodAmount: 133.2,
      currentPeriod: 5,
      nextRepayDate: '2026-05-28',
      status: '待收货',
      createdAt: '2026-05-05 10:18',
      installmentPlan: [
        { period: 1, dueDate: '2026-01-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: true },
        { period: 2, dueDate: '2026-02-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: true },
        { period: 3, dueDate: '2026-03-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: true },
        { period: 4, dueDate: '2026-04-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: true },
        { period: 5, dueDate: '2026-05-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 6, dueDate: '2026-06-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 7, dueDate: '2026-07-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 8, dueDate: '2026-08-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 9, dueDate: '2026-09-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 10, dueDate: '2026-10-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 11, dueDate: '2026-11-28', principal: 123.33, fee: 9.87, amount: 133.2, paid: false },
        { period: 12, dueDate: '2026-12-28', principal: 123.37, fee: 9.83, amount: 133.2, paid: false },
      ],
    },
    {
      id: 'ORD-20260505-003',
      user: '王五',
      product: '武夷山大红袍',
      totalAmount: 1680,
      periods: 3,
      periodAmount: 582.4,
      currentPeriod: 1,
      nextRepayDate: '2026-05-12',
      status: '待付款',
      createdAt: '2026-05-05 11:44',
      installmentPlan: [
        { period: 1, dueDate: '2026-05-12', principal: 560, fee: 22.4, amount: 582.4, paid: false },
        { period: 2, dueDate: '2026-06-12', principal: 560, fee: 22.4, amount: 582.4, paid: false },
        { period: 3, dueDate: '2026-07-12', principal: 560, fee: 22.4, amount: 582.4, paid: false },
      ],
    },
    {
      id: 'ORD-20260505-004',
      user: '赵六',
      product: '古树普洱熟茶',
      totalAmount: 980,
      periods: 6,
      periodAmount: 171.5,
      currentPeriod: 6,
      nextRepayDate: '-',
      status: '已完成',
      createdAt: '2026-05-05 14:08',
      installmentPlan: [
        { period: 1, dueDate: '2025-12-08', principal: 163.33, fee: 8.17, amount: 171.5, paid: true },
        { period: 2, dueDate: '2026-01-08', principal: 163.33, fee: 8.17, amount: 171.5, paid: true },
        { period: 3, dueDate: '2026-02-08', principal: 163.33, fee: 8.17, amount: 171.5, paid: true },
        { period: 4, dueDate: '2026-03-08', principal: 163.33, fee: 8.17, amount: 171.5, paid: true },
        { period: 5, dueDate: '2026-04-08', principal: 163.33, fee: 8.17, amount: 171.5, paid: true },
        { period: 6, dueDate: '2026-05-08', principal: 163.35, fee: 8.15, amount: 171.5, paid: true },
      ],
    },
  ]
}

const orders = ref<OrderItem[]>(createMockOrders())

function recalculateOrderFields(order: OrderItem) {
  const nextPending = order.installmentPlan.find(item => !item.paid)
  const allPaid = order.installmentPlan.every(item => item.paid)

  if (allPaid) {
    order.currentPeriod = order.periods
    order.nextRepayDate = '-'
    order.status = '已完成'
    return
  }

  if (nextPending) {
    order.currentPeriod = nextPending.period
    order.nextRepayDate = nextPending.dueDate
  }

  if (order.status === '已完成') {
    order.status = '待收货'
  }
}

export function useOrdersStore() {
  return {
    orders,
    recalculateOrderFields,
  }
}
