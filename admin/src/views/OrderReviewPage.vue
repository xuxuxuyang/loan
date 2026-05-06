<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { OrderItem } from '../stores/useOrdersStore'
import { useOrdersStore } from '../stores/useOrdersStore'

const loading = ref(false)
const reviewingId = ref('')
const { orders, fetchOrders, updateOrderStatus } = useOrdersStore()
let syncTimer: number | null = null

const reviewOrders = computed(() => {
  return orders.value.filter(item => item.status === '待审核')
})

async function loadReviewOrders() {
  loading.value = true
  try {
    await fetchOrders({
      status: '待审核',
    })
  }
  finally {
    loading.value = false
  }
}

async function approveOrder(order: OrderItem) {
  if (reviewingId.value) {
    return
  }
  reviewingId.value = order.id
  try {
    await updateOrderStatus(order.id, 'shipping')
  }
  catch (error) {
    // eslint-disable-next-line no-alert
    window.alert('审核通过失败，请稍后重试')
  }
  finally {
    reviewingId.value = ''
    await loadReviewOrders()
  }
}

onMounted(() => {
  void loadReviewOrders()
  syncTimer = window.setInterval(() => {
    void loadReviewOrders()
  }, 3000)
})

onBeforeUnmount(() => {
  if (syncTimer !== null) {
    window.clearInterval(syncTimer)
  }
})
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <input
        value="分期订单需人工审核，审核通过后进入待发货"
        readonly
      >
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>商品</th>
          <th>总金额</th>
          <th>支付方式</th>
          <th>当前期数</th>
          <th>下次还款日</th>
          <th>下单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td
            colspan="9"
            style="text-align: center; color: #6b7280;"
          >
            数据加载中...
          </td>
        </tr>
        <tr
          v-for="item in reviewOrders"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.user }}</td>
          <td>{{ item.product }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td>{{ item.payType }}</td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td>{{ item.createdAt }}</td>
          <td>
            <button
              class="btn btn-success"
              type="button"
              :disabled="reviewingId === item.id"
              @click="approveOrder(item)"
            >
              {{ reviewingId === item.id ? '审核中...' : '审核通过' }}
            </button>
          </td>
        </tr>
        <tr v-if="!loading && reviewOrders.length === 0">
          <td
            colspan="9"
            style="text-align: center; color: #9ca3af;"
          >
            暂无待审核订单
          </td>
        </tr>
      </tbody>
    </table>
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

.btn-success {
  border-color: #059669;
  background: #059669;
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
