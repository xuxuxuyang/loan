<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InstallmentItem, OrderItem } from '../stores/useOrdersStore'
import { useOrdersStore } from '../stores/useOrdersStore'

const keyword = ref('')
const status = ref<'全部' | OrderItem['status']>('全部')
const selectedOrder = ref<OrderItem | null>(null)
const { orders, recalculateOrderFields } = useOrdersStore()

const filteredOrders = computed(() => {
  return orders.value.filter((item) => {
    const byStatus = status.value === '全部' || item.status === status.value
    const byKeyword = !keyword.value.trim()
      || item.id.includes(keyword.value.trim())
      || item.user.includes(keyword.value.trim())
      || item.product.includes(keyword.value.trim())
    return byStatus && byKeyword
  })
})

function openPlan(order: OrderItem) {
  selectedOrder.value = order
}

function closePlan() {
  selectedOrder.value = null
}

function toggleRepay(order: OrderItem, period: InstallmentItem) {
  period.paid = !period.paid
  recalculateOrderFields(order)
}
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <input
        v-model="keyword"
        placeholder="搜索订单号 / 用户 / 商品"
      >
      <select v-model="status">
        <option value="全部">
          全部状态
        </option>
        <option value="待付款">
          待付款
        </option>
        <option value="待发货">
          待发货
        </option>
        <option value="待收货">
          待收货
        </option>
        <option value="已完成">
          已完成
        </option>
      </select>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>商品</th>
          <th>总金额</th>
          <th>分期期数</th>
          <th>每期应还</th>
          <th>当前期数</th>
          <th>下次还款日</th>
          <th>状态</th>
          <th>下单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredOrders"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.user }}</td>
          <td>{{ item.product }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td>{{ item.periods }} 期</td>
          <td>¥ {{ item.periodAmount }}</td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.createdAt }}</td>
          <td>
            <button
              class="btn btn-primary"
              type="button"
              @click="openPlan(item)"
            >
              查看分期
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="selectedOrder"
    class="modal-mask"
    @click.self="closePlan"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>分期计划 - {{ selectedOrder.id }}</h3>
        <button
          class="btn"
          type="button"
          @click="closePlan"
        >
          关闭
        </button>
      </div>
      <p class="modal-summary">
        用户：{{ selectedOrder.user }} ｜ 商品：{{ selectedOrder.product }} ｜ 总金额：¥ {{ selectedOrder.totalAmount }}
      </p>

      <table class="table">
        <thead>
          <tr>
            <th>期数</th>
            <th>还款日</th>
            <th>本金</th>
            <th>手续费</th>
            <th>应还金额</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="plan in selectedOrder.installmentPlan"
            :key="plan.period"
          >
            <td>第 {{ plan.period }} 期</td>
            <td>{{ plan.dueDate }}</td>
            <td>¥ {{ plan.principal }}</td>
            <td>¥ {{ plan.fee }}</td>
            <td>¥ {{ plan.amount }}</td>
            <td>{{ plan.paid ? '已还款' : '待还款' }}</td>
            <td>
              <button
                class="btn"
                :class="plan.paid ? 'btn-warning' : 'btn-success'"
                type="button"
                @click="toggleRepay(selectedOrder, plan)"
              >
                {{ plan.paid ? '标记未还' : '标记已还' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-success {
  border-color: #059669;
  background: #059669;
  color: #fff;
}

.btn-warning {
  border-color: #d97706;
  background: #d97706;
  color: #fff;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
  width: 900px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-header h3 {
  margin: 0;
}

.modal-summary {
  margin: 0 0 12px;
  color: #4b5563;
  font-size: 14px;
}
</style>
