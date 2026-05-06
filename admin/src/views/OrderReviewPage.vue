<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { OrderItem } from '../stores/useOrdersStore'
import { useOrdersStore } from '../stores/useOrdersStore'

const loading = ref(false)
const reviewingId = ref('')
const { orders, fetchOrders, updateOrderStatus } = useOrdersStore()

const reviewOrders = computed(() => {
  // 审核订单页展示人工待审和风控打回订单，避免与订单管理页重复展示。
  return orders.value.filter(item => item.status === '待审核' || item.status === '风控未通过')
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
  if (order.riskStatus !== 'passed') {
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
})
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <input
        value="分期订单先过风控，风控通过后可人工审核；风控未通过将直接打回"
        readonly
      >
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="loadReviewOrders"
      >
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>商品</th>
          <th>总金额</th>
          <th>支付方式</th>
          <th>风控结果</th>
          <th>当前期数</th>
          <th>下次还款日</th>
          <th>下单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td
            colspan="10"
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
          <td>
            <span :class="item.riskStatus === 'passed' ? 'risk-pass' : 'risk-fail'">
              {{ item.riskStatus === 'passed' ? '风控通过' : '风控未通过' }}
            </span>
          </td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td>{{ item.createdAt }}</td>
          <td>
            <button
              class="btn btn-success"
              type="button"
              :disabled="reviewingId === item.id || item.riskStatus !== 'passed'"
              @click="approveOrder(item)"
            >
              {{
                item.riskStatus !== 'passed'
                  ? '风控未通过'
                  : (reviewingId === item.id ? '审核中...' : '审核通过')
              }}
            </button>
          </td>
        </tr>
        <tr v-if="!loading && reviewOrders.length === 0">
          <td
            colspan="10"
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

.btn-refresh {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.risk-pass {
  color: #0f8b6f;
  font-weight: 600;
}

.risk-fail {
  color: #cf3d3d;
  font-weight: 600;
}
</style>
