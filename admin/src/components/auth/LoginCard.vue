<script setup lang="ts">
import { reactive } from 'vue'

const props = defineProps<{
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  submit: [payload: { username: string, password: string }]
}>()

const form = reactive({
  username: 'admin',
  password: '1234',
})

function handleSubmit() {
  if (!form.username.trim() || !form.password.trim()) {
    return
  }
  emit('submit', {
    username: form.username.trim(),
    password: form.password.trim(),
  })
}
</script>

<template>
  <div class="login-card">
    <div class="login-card__glow" />
    <div class="login-card__header">
      <h1>后台登录</h1>
      <p>欢迎进入琥珀商城管理中台</p>
    </div>

    <label class="login-field">
      <span>账号</span>
      <input
        v-model="form.username"
        type="text"
        autocomplete="username"
        placeholder="请输入账号"
      >
    </label>

    <label class="login-field">
      <span>密码</span>
      <input
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        placeholder="请输入密码"
        @keyup.enter="handleSubmit"
      >
    </label>

    <p
      v-if="props.error"
      class="login-error"
    >
      {{ props.error }}
    </p>

    <button
      class="login-btn"
      type="button"
      :disabled="props.loading"
      @click="handleSubmit"
    >
      {{ props.loading ? '登录中...' : '立即登录' }}
    </button>

    <div class="login-tip">
      默认超管账号：`admin` / `1234`
    </div>
  </div>
</template>

<style scoped>
.login-card {
  position: relative;
  width: min(420px, 90vw);
  padding: 28px 26px;
  border-radius: 18px;
  background: rgba(9, 15, 38, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.28);
  box-shadow: 0 18px 60px rgba(3, 8, 28, 0.55);
  backdrop-filter: blur(8px);
  color: #e2e8f0;
  overflow: hidden;
}

.login-card__glow {
  position: absolute;
  width: 280px;
  height: 280px;
  right: -100px;
  top: -120px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.45), rgba(59, 130, 246, 0.04));
  pointer-events: none;
}

.login-card__header h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: 0.5px;
}

.login-card__header p {
  margin: 8px 0 18px;
  color: #cbd5e1;
  font-size: 13px;
}

.login-field {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}

.login-field span {
  font-size: 13px;
  color: #cbd5e1;
}

.login-field input {
  height: 42px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.72);
  color: #f8fafc;
  padding: 0 12px;
  outline: none;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.login-field input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
}

.login-error {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.18);
  border: 1px solid rgba(248, 113, 113, 0.42);
  color: #fecaca;
  font-size: 13px;
}

.login-btn {
  width: 100%;
  height: 42px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: #082f49;
  background: linear-gradient(115deg, #38bdf8, #22d3ee, #818cf8);
  background-size: 160% 160%;
  animation: btnGradient 5s ease infinite;
  transition: transform 0.2s;
}

.login-btn:hover {
  transform: translateY(-1px);
}

.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.login-tip {
  margin-top: 12px;
  color: #94a3b8;
  font-size: 12px;
}

@keyframes btnGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
</style>
