<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'

const route = useRoute()

const isSuccess = computed(() => String(route.query.isBack || '').trim() === '1')
const isFailed = computed(() => String(route.query.isBack || '').trim() === '0')

const resultTitle = computed(() => {
  if (isSuccess.value) return '流水资料已提交'
  if (isFailed.value) return '流水资料提交失败'
  return '流水资料处理中'
})

const resultDesc = computed(() => {
  if (isSuccess.value) {
    return '我们已收到你的投递操作，报告解析需要一点时间，请稍后等待审核人员处理。'
  }
  if (isFailed.value) {
    return '本次投递没有完成，你可以返回后重新打开流水提交入口再次操作。'
  }
  return '请从工作人员提供的流水提交入口进入；如果你已经完成投递，请耐心等待报告解析。'
})
</script>

<template>
  <div class="bill-risk-result-page">
    <main class="bill-risk-result-shell">
      <section
        class="bill-risk-result-card"
        :class="{
          'bill-risk-result-card--success': isSuccess,
          'bill-risk-result-card--failed': isFailed,
        }"
      >
        <div class="bill-risk-result-orbit" aria-hidden="true">
          <span class="bill-risk-result-orbit__dot" />
          <span class="bill-risk-result-orbit__ring" />
        </div>

        <div class="bill-risk-result-icon" aria-hidden="true">
          <span v-if="isSuccess">✓</span>
          <span v-else-if="isFailed">!</span>
          <span v-else>…</span>
        </div>

        <h1>{{ resultTitle }}</h1>
        <p>{{ resultDesc }}</p>

        <div class="bill-risk-result-tips">
          <div class="bill-risk-result-tip">
            <strong>报告生成</strong>
            <span>流水报告由服务方异步解析，完成后会自动同步给平台。</span>
          </div>
          <div class="bill-risk-result-tip">
            <strong>无需重复提交</strong>
            <span>如果已经成功投递，请不要频繁重复操作，避免产生重复记录。</span>
          </div>
        </div>

        <div class="bill-risk-result-actions">
          <RouterLink class="bill-risk-result-btn bill-risk-result-btn--primary" to="/">
            返回首页
          </RouterLink>
          <RouterLink class="bill-risk-result-btn" to="/my">
            进入我的
          </RouterLink>
        </div>
      </section>
    </main>

    <AppTabbar />
  </div>
</template>

<style scoped>
.bill-risk-result-page {
  min-height: 100vh;
  padding-top: var(--app-safe-area-top);
  padding-bottom: calc(4.5rem + var(--app-safe-area-bottom));
  background:
    radial-gradient(circle at 18% 14%, rgba(255, 117, 156, 0.24), transparent 28%),
    radial-gradient(circle at 86% 8%, rgba(0, 113, 98, 0.18), transparent 26%),
    linear-gradient(180deg, #fff7f8 0%, #f3f7f5 52%, #eef4f1 100%);
}

.bill-risk-result-shell {
  width: min(100%, 520px);
  margin: 0 auto;
  padding: 28px 18px 18px;
}

.bill-risk-result-card {
  position: relative;
  overflow: hidden;
  min-height: 560px;
  padding: 44px 22px 26px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 22px 60px rgba(44, 62, 80, 0.14);
  backdrop-filter: blur(18px);
  text-align: center;
}

.bill-risk-result-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(135deg, rgba(255, 98, 133, 0.12), transparent 34%),
    linear-gradient(315deg, rgba(0, 113, 98, 0.12), transparent 36%);
  pointer-events: none;
}

.bill-risk-result-orbit {
  position: absolute;
  top: 28px;
  right: 28px;
  width: 86px;
  height: 86px;
  opacity: 0.72;
}

.bill-risk-result-orbit__ring {
  position: absolute;
  inset: 10px;
  border: 1px dashed rgba(0, 113, 98, 0.35);
  border-radius: 999px;
  animation: bill-risk-spin 9s linear infinite;
}

.bill-risk-result-orbit__dot {
  position: absolute;
  top: 4px;
  left: 40px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #ff5f8f;
  box-shadow: 0 0 0 8px rgba(255, 95, 143, 0.12);
}

.bill-risk-result-icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 92px;
  height: 92px;
  margin-top: 28px;
  border-radius: 30px;
  color: #fff;
  font-size: 44px;
  font-weight: 900;
  background: linear-gradient(135deg, #007162, #13b095);
  box-shadow: 0 16px 34px rgba(0, 113, 98, 0.28);
  animation: bill-risk-pop 0.48s ease-out both;
}

.bill-risk-result-card--failed .bill-risk-result-icon {
  background: linear-gradient(135deg, #ff5f8f, #ef476f);
  box-shadow: 0 16px 34px rgba(239, 71, 111, 0.28);
}

.bill-risk-result-card h1 {
  position: relative;
  z-index: 1;
  margin: 28px 0 10px;
  font-size: 28px;
  line-height: 1.18;
  letter-spacing: -0.03em;
  color: #17211f;
}

.bill-risk-result-card p {
  position: relative;
  z-index: 1;
  max-width: 360px;
  margin: 0 auto;
  font-size: 15px;
  line-height: 1.75;
  color: #596965;
}

.bill-risk-result-tips {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
  margin-top: 30px;
  text-align: left;
}

.bill-risk-result-tip {
  padding: 14px 15px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 113, 98, 0.1);
}

.bill-risk-result-tip strong {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  color: #17211f;
}

.bill-risk-result-tip span {
  display: block;
  font-size: 13px;
  line-height: 1.55;
  color: #6a7774;
}

.bill-risk-result-actions {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 30px;
}

.bill-risk-result-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  border-radius: 999px;
  color: #007162;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(0, 113, 98, 0.16);
}

.bill-risk-result-btn--primary {
  color: #fff;
  border: none;
  background: linear-gradient(135deg, #007162, #11a88f);
  box-shadow: 0 12px 24px rgba(0, 113, 98, 0.22);
}

@keyframes bill-risk-pop {
  from {
    transform: translateY(10px) scale(0.86);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes bill-risk-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
