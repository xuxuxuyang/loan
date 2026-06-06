<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  createTrafficCreditLeadSessionKey,
  shouldShowTrafficCreditLead,
} from '~/utils/trafficLead'
import {
  getPendingRegisterChannel,
  resolveChannelFromRouteQuery,
} from '~/composables/useRegisterChannel'

const route = useRoute()
const router = useRouter()
const { isLoggedIn } = useMallAuth()
const registeredCookie = useCookie<string>('mall_registered', {
  maxAge: 60 * 60 * 24 * 365,
  default: () => '',
})

const visible = ref(false)
const dismissed = ref(false)
const sessionKey = createTrafficCreditLeadSessionKey()

const currentChannel = computed(() =>
  resolveChannelFromRouteQuery(route.query as Record<string, unknown>) || getPendingRegisterChannel(),
)

function readSessionShown() {
  if (typeof sessionStorage === 'undefined') {
    return dismissed.value
  }
  try {
    return dismissed.value || sessionStorage.getItem(sessionKey) === '1'
  }
  catch {
    return dismissed.value
  }
}

function markSessionShown() {
  dismissed.value = true
  if (typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.setItem(sessionKey, '1')
  }
  catch {
    /* ignore private-mode storage failures */
  }
}

function evaluateLeadDialog() {
  if (import.meta.env.SSR) {
    return
  }
  visible.value = shouldShowTrafficCreditLead({
    isLoggedIn: isLoggedIn.value,
    hasRegisteredMarker: !!registeredCookie.value,
    routePath: route.path,
    sessionShown: readSessionShown(),
    channel: currentChannel.value,
  })
}

function closeLeadDialog() {
  markSessionShown()
  visible.value = false
}

async function goRegister() {
  markSessionShown()
  visible.value = false
  const channel = currentChannel.value
  await router.push({
    path: '/register',
    query: channel ? { channel } : undefined,
  })
}

onMounted(() => {
  void nextTick(evaluateLeadDialog)
})

watch(
  () => [route.fullPath, isLoggedIn.value, registeredCookie.value],
  () => {
    void nextTick(evaluateLeadDialog)
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="traffic-credit-lead-fade">
      <div
        v-if="visible"
        class="traffic-credit-lead"
        role="dialog"
        aria-modal="true"
        aria-labelledby="traffic-credit-lead-title"
      >
        <div
          class="traffic-credit-lead__backdrop"
          @click="closeLeadDialog"
        />
        <section class="traffic-credit-lead__panel">
          <button
            type="button"
            class="traffic-credit-lead__close"
            aria-label="关闭额度提示"
            @click="closeLeadDialog"
          >
            ×
          </button>

          <div class="traffic-credit-lead__shine" />
          <div class="traffic-credit-lead__badge">
            今日专属额度
          </div>
          <h2 id="traffic-credit-lead-title" class="traffic-credit-lead__title">
            您有 <strong>3000</strong> 额度可用
          </h2>
          <p class="traffic-credit-lead__subtitle">
            完成注册后即可查看您的先享后付资格，热门商品可先下单后付款。
          </p>

          <div class="traffic-credit-lead__steps" aria-label="领取步骤">
            <span>1 秒注册</span>
            <i />
            <span>查看额度</span>
            <i />
            <span>立即下单</span>
          </div>

          <button
            type="button"
            class="traffic-credit-lead__primary"
            @click="goRegister"
          >
            立即领取额度
          </button>
          <button
            type="button"
            class="traffic-credit-lead__secondary"
            @click="closeLeadDialog"
          >
            稍后再说
          </button>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.traffic-credit-lead {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.traffic-credit-lead__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(37, 27, 24, 0.46);
  backdrop-filter: blur(10px);
}

.traffic-credit-lead__panel {
  position: relative;
  width: min(88vw, 360px);
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(255, 224, 177, 0.72);
  background:
    radial-gradient(circle at 18% 8%, rgba(255, 236, 178, 0.95), transparent 34%),
    linear-gradient(160deg, #fff9ee 0%, #fff0dc 45%, #fffaf3 100%);
  box-shadow: 0 24px 56px rgba(140, 57, 24, 0.28);
  padding: 24px 20px 18px;
  text-align: center;
}

.traffic-credit-lead__close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #9a6c4b;
  font-size: 22px;
  line-height: 28px;
}

.traffic-credit-lead__shine {
  position: absolute;
  top: -92px;
  right: -76px;
  width: 190px;
  height: 190px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 201, 77, 0.46), transparent 70%);
}

.traffic-credit-lead__badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 117, 62, 0.12);
  color: #e95f2e;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.traffic-credit-lead__title {
  position: relative;
  margin: 14px 0 8px;
  color: #34241c;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.traffic-credit-lead__title strong {
  color: #ff4f35;
  font-size: 42px;
  font-weight: 900;
  text-shadow: 0 7px 18px rgba(255, 90, 57, 0.26);
}

.traffic-credit-lead__subtitle {
  margin: 0 auto;
  color: #725c4c;
  font-size: 14px;
  line-height: 1.7;
}

.traffic-credit-lead__steps {
  display: grid;
  grid-template-columns: 1fr 12px 1fr 12px 1fr;
  align-items: center;
  gap: 6px;
  margin: 16px 0 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 8px;
  color: #b6672d;
  font-size: 12px;
  font-weight: 700;
}

.traffic-credit-lead__steps i {
  display: block;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffd48c, #ff8359);
}

.traffic-credit-lead__primary,
.traffic-credit-lead__secondary {
  width: 100%;
  border: 0;
  border-radius: 999px;
  font-weight: 800;
}

.traffic-credit-lead__primary {
  background: linear-gradient(135deg, #ff8b3d, #ff4f43 58%, #e93145);
  box-shadow: 0 12px 24px rgba(255, 90, 57, 0.34);
  color: #fff;
  padding: 13px 16px;
  font-size: 16px;
}

.traffic-credit-lead__secondary {
  margin-top: 8px;
  background: transparent;
  color: #9b7861;
  padding: 9px 16px;
  font-size: 13px;
}

.traffic-credit-lead-fade-enter-active,
.traffic-credit-lead-fade-leave-active {
  transition: opacity 0.22s ease;
}

.traffic-credit-lead-fade-enter-from,
.traffic-credit-lead-fade-leave-to {
  opacity: 0;
}
</style>
