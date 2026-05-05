<script setup lang="ts">
const products = useTeaProducts()
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

const orderStatus = [
  { title: '审核中', icon: 'tabler:clock-bolt' },
  { title: '待发货', icon: 'tabler:clock-hour-4' },
  { title: '待收货', icon: 'tabler:truck-delivery' },
  { title: '享用中', icon: 'tabler:clipboard-check' },
]

const serviceList = [
  { title: '收货地址', icon: 'tabler:map-pin' },
  { title: '在线客服', icon: 'tabler:message-dots' },
  { title: '常见问题', icon: 'tabler:help-circle' },
  { title: 'App下载', icon: 'tabler:download' },
  { title: '隐私政策', icon: 'tabler:lock' },
  { title: '注销', icon: 'tabler:circle-x' },
]

const { ensureRegistered } = useMallAuth()

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
  <section class="bg-[#f3f4f8] px-4 pb-5 pt-4">
    <div class="mb-3 flex items-center gap-3">
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
        <Icon
          name="tabler:user-filled"
          size="2rem"
          class="text-black/25"
        />
      </div>
      <div>
        <button
          type="button"
          class="text-[1.55rem] font-semibold leading-none text-black/80"
          @click="handleGoRegister"
        >
          登录/注册
        </button>
      </div>
    </div>

    <div class="relative mb-3 rounded-2xl bg-white p-4">
      <div class="absolute right-0 top-0 rounded-bl-xl rounded-tr-2xl bg-[#fdeef1] px-3 py-1 text-[11px] text-[#e6949f]">
        账单还款 请在登录后查看
      </div>
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-[1.75rem] font-semibold text-black/85">
          商城订单
        </h3>
        <button
          type="button"
          class="text-lg text-black/50"
        >
          全部 >
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <article
          v-for="item in orderStatus"
          :key="item.title"
          class="py-1"
        >
          <div class="mb-1 flex justify-center">
            <Icon
              :name="item.icon"
              size="1.6rem"
              class="text-[#70727a]"
            />
          </div>
          <p class="text-[15px] text-black/75">
            {{ item.title }}
          </p>
        </article>
      </div>
    </div>

    <div class="mb-3 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3 text-center">
      <article class="flex items-center justify-between rounded-xl bg-[#fff6f6] px-4 py-3">
        <p class="text-lg font-semibold text-black/80">
          我的银行卡
        </p>
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8695] text-white">
          <Icon
            name="tabler:credit-card"
            size="0.9rem"
          />
        </span>
      </article>
      <article class="flex items-center justify-between rounded-xl bg-[#fff6f6] px-4 py-3">
        <p class="text-lg font-semibold text-black/80">
          全部账单
        </p>
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8695] text-white">
          <Icon
            name="tabler:receipt-2"
            size="0.9rem"
          />
        </span>
      </article>
    </div>

    <div class="mb-3 rounded-2xl bg-white p-4">
      <h3 class="mb-3 flex items-center text-[1.75rem] font-semibold text-black/85">
        <span class="mr-2 h-3 w-1 rounded bg-[#ff9ea9]" />
        其他服务
      </h3>
      <div class="grid grid-cols-4 gap-3">
        <article
          v-for="item in serviceList"
          :key="item.title"
          class="text-center"
        >
          <div class="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff6678] text-white">
            <Icon
              :name="item.icon"
              size="1rem"
            />
          </div>
          <p class="text-[14px] text-black/75">
            {{ item.title }}
          </p>
        </article>
      </div>
    </div>

    <div class="mb-4 rounded-2xl bg-white px-3 py-4 text-center normal-font">
      <p class="text-lg leading-6 text-black/65">
        客服电话：<span class="font-semibold text-[#c06b37]">13008962100</span>
      </p>
      <p class="mt-1 text-lg leading-6 text-black/45">
        9:00-18:00
      </p>
    </div>

    <div>
      <div class="mb-3 text-center">
        <h3 class="text-2xl font-semibold text-black/85">
          推荐商品
        </h3>
        <div class="mx-auto mt-1 h-1 w-16 rounded-full bg-[#79d2c7]" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <article
          v-for="item in products.slice(0, 4)"
          :key="item.id"
          class="overflow-hidden rounded-2xl bg-white"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-28 w-full object-cover"
          >
          <div class="p-2.5">
            <p class="line-clamp-1 text-sm font-semibold text-black/85">
              {{ item.name }}
            </p>
            <p class="mt-1 text-xs text-black/55">
              {{ item.subtitle }}
            </p>
            <div class="mt-2 flex items-center justify-between">
              <p class="text-sm font-semibold text-[#d45a33]">
                ￥{{ item.price }}
              </p>
              <button
                type="button"
                class="rounded-md bg-[var(--theme-color)] px-2 py-1 text-[11px] text-white"
                @click="handleBuy(item.name)"
              >
                购买
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

section :is(h3, p, button, span) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
