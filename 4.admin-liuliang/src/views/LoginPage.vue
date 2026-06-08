<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TrafficPartnerLogo from '../components/TrafficPartnerLogo.vue'
import { setTrafficPartnerSession } from '../composables/useTrafficPartnerAuth'
import { MALL_API_BASE } from '../composables/useTrafficPartnerApi'
import { withTrafficPartnerHeaders } from '../utils/tenant'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')

const form = reactive({
  username: '',
  password: '',
})

async function handleSubmit() {
  const username = form.username.trim()
  const password = form.password.trim()
  if (!username || !password || loading.value) {
    return
  }
  error.value = ''
  loading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/traffic-partner/login`, {
      method: 'POST',
      headers: withTrafficPartnerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username, password }),
    })
    const rawText = await response.text()
    let result: {
      success?: boolean
      msg?: string
      data?: { token: string, username: string, name: string, partnerId: string }
    } = {}
    try {
      result = JSON.parse(rawText)
    }
    catch {
      result = { msg: rawText || '登录失败，请检查接口地址' }
    }
    if (!response.ok || !result?.data?.token) {
      throw new Error(result?.msg || '登录失败')
    }
    setTrafficPartnerSession({
      token: result.data.token,
      username: result.data.username || username,
      name: String(result.data.name || username),
      partnerId: result.data.partnerId,
      loginAt: new Date().toISOString(),
    })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect || '/')
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div
      class="login-page__bg"
      aria-hidden="true"
    />
    <div
      class="login-page__veil"
      aria-hidden="true"
    />

    <div class="login-page__layout">
      <section
        class="login-hero"
        aria-hidden="true"
      >
        <TrafficPartnerLogo :size="72" />
        <h2 class="login-hero__title">
          渠道引流数据平台
        </h2>
        <p class="login-hero__desc">
          实时掌握推广点击、注册转化与订单表现，助力流量合作透明可查。
        </p>
        <ul class="login-hero__tags">
          <li>点击归因</li>
          <li>注册统计</li>
          <li>转化分析</li>
        </ul>
      </section>

      <div class="login-panel">
        <div class="login-panel__brand">
          <TrafficPartnerLogo :size="48" />
          <div>
            <h1>流量商数据后台</h1>
            <p>登录后查看您名下渠道的引流转化数据</p>
          </div>
        </div>

        <el-form
          label-position="top"
          class="login-panel__form"
          @submit.prevent="handleSubmit"
        >
          <el-form-item label="账号">
            <el-input
              v-model="form.username"
              autocomplete="username"
              placeholder="请输入流量商账号"
              clearable
              size="large"
            />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              show-password
              size="large"
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <el-alert
            v-if="error"
            type="error"
            :title="error"
            show-icon
            :closable="false"
            class="login-panel__error"
          />

          <el-button
            type="primary"
            class="login-panel__submit"
            :loading="loading"
            size="large"
            native-type="submit"
          >
            登录
          </el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
}

.login-page__bg {
  position: absolute;
  inset: 0;
  background: url('/login-bg.svg') center / cover no-repeat;
  background-color: #1e3a8a;
}

.login-page__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(15, 23, 42, 0.55) 0%,
    rgba(30, 58, 138, 0.35) 42%,
    rgba(15, 23, 42, 0.2) 100%
  );
}

.login-page__layout {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48px;
  min-height: 100vh;
  padding: 32px 24px;
  max-width: 1080px;
  margin: 0 auto;
}

.login-hero {
  flex: 1;
  max-width: 400px;
  color: #f8fafc;
  display: none;
}

.login-hero__title {
  margin: 20px 0 12px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.login-hero__desc {
  margin: 0 0 24px;
  font-size: 15px;
  line-height: 1.65;
  color: rgba(248, 250, 252, 0.82);
}

.login-hero__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.login-hero__tags li {
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
}

.login-panel {
  width: 100%;
  max-width: 420px;
  padding: 36px 32px 32px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 16px;
  box-shadow:
    0 24px 48px rgba(15, 23, 42, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.5) inset;
  backdrop-filter: blur(12px);
}

.login-panel__brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.login-panel__brand h1 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: #1e3a8a;
}

.login-panel__brand p {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.4;
}

.login-panel__form :deep(.el-form-item__label) {
  font-weight: 500;
  color: #334155;
}

.login-panel__error {
  margin-bottom: 12px;
}

.login-panel__submit {
  width: 100%;
  margin-top: 4px;
  --el-button-bg-color: #2563eb;
  --el-button-border-color: #2563eb;
  --el-button-hover-bg-color: #1d4ed8;
  --el-button-hover-border-color: #1d4ed8;
}

@media (min-width: 900px) {
  .login-hero {
    display: block;
  }

  .login-page__layout {
    justify-content: space-between;
    padding: 48px 40px;
  }
}

@media (max-width: 480px) {
  .login-panel {
    padding: 28px 20px 24px;
  }

  .login-panel__brand {
    flex-direction: column;
    text-align: center;
  }
}
</style>
