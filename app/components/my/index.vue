<script setup lang="ts">
const products = useTeaProducts()
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered } = useMallAuth()

const orderStatus = [
  { title: '审核中', icon: '⏱️' },
  { title: '待发货', icon: '🕘' },
  { title: '待收货', icon: '🚚' },
  { title: '享用中', icon: '📋' },
]

const serviceList = [
  { title: '收货地址', icon: '📍' },
  { title: '在线客服', icon: '💬' },
  { title: '常见问题', icon: '❓' },
  { title: 'App下载', icon: '⬇️' },
  { title: '隐私政策', icon: '🔒' },
  { title: '注销', icon: '✖️' },
]

async function handleGoRegister() {
  await smartNavigate('/login')
}

async function handleBuy(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`下单成功：${productName}`)
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-6 md:py-8">
    <div class="app-content max-w-[920px]">
      <div class="mb-6 rounded-3xl bg-[#eaf2f5] p-6">
        <div class="mb-4 flex items-center gap-4">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-white text-4xl shadow-sm">
            👤
          </div>
          <div>
            <button
              type="button"
              class="text-3xl font-semibold text-black/80"
              @click="handleGoRegister"
            >
              登录/注册
            </button>
            <p class="text-sm text-black/45">
              账户还款、资产信息登录后查看
            </p>
          </div>
        </div>

        <div class="mb-4 rounded-3xl bg-white p-5">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-3xl font-semibold text-black/85">
              商城订单
            </h3>
            <button
              type="button"
              class="text-lg text-black/50"
            >
              全部 >
            </button>
          </div>
          <div class="grid grid-cols-4 gap-3 text-center">
            <article
              v-for="item in orderStatus"
              :key="item.title"
              class="py-1"
            >
              <p class="mb-1 text-3xl">
                {{ item.icon }}
              </p>
              <p class="text-base text-black/70">
                {{ item.title }}
              </p>
            </article>
          </div>
        </div>

        <div class="mb-4 grid grid-cols-2 gap-4 rounded-3xl bg-white p-4 text-center">
          <article class="rounded-xl bg-[#fff6f6] px-3 py-4">
            <p class="text-2xl font-semibold text-black/80">
              我的银行卡
            </p>
          </article>
          <article class="rounded-xl bg-[#fff6f6] px-3 py-4">
            <p class="text-2xl font-semibold text-black/80">
              全部账单
            </p>
          </article>
        </div>

        <div class="mb-4 rounded-3xl bg-white p-5">
          <h3 class="mb-4 text-3xl font-semibold text-black/85">
            其他服务
          </h3>
          <div class="grid grid-cols-6 gap-4">
            <article
              v-for="item in serviceList"
              :key="item.title"
              class="text-center"
            >
              <div class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff6b75] text-lg text-white">
                {{ item.icon }}
              </div>
              <p class="text-sm text-black/75">
                {{ item.title }}
              </p>
            </article>
          </div>
        </div>

        <div class="rounded-3xl bg-white px-3 py-4 text-center">
          <p class="text-xl text-black/65">
            客服电话：<span class="font-semibold text-[#c06b37]">13008962100</span>
          </p>
          <p class="mt-1 text-lg text-black/45">
            9:00-18:00
          </p>
        </div>
      </div>

      <div>
        <div class="mb-4 text-center">
          <h3 class="text-4xl font-semibold text-black/85">
            推荐商品
          </h3>
          <div class="mx-auto mt-2 h-1 w-20 rounded-full bg-[#79d2c7]" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <article
            v-for="item in products.slice(0, 4)"
            :key="item.id"
            class="overflow-hidden rounded-2xl bg-white"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="h-44 w-full object-cover"
            >
            <div class="p-3">
              <p class="line-clamp-1 text-base font-semibold text-black/85">
                {{ item.name }}
              </p>
              <p class="mt-1 text-sm text-black/55">
                {{ item.subtitle }}
              </p>
              <div class="mt-2 flex items-center justify-between">
                <p class="text-base font-semibold text-[#d45a33]">
                  ￥{{ item.price }}
                </p>
                <button
                  type="button"
                  class="rounded-md bg-[var(--theme-color)] px-3 py-1.5 text-xs text-white"
                  @click="handleBuy(item.name)"
                >
                  购买
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
