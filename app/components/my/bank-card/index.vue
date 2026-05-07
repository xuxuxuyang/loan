<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { loginPhone, profile, syncFromStorage } = useMallAuth()
const { bankCards: cards, fetchBankCards, createBankCard, deleteBankCard } = useMallMy()

const tips = [
  '为保障资金安全，修改银行卡前需进行短信验证。',
  '分期订单优先使用默认银行卡自动扣款。',
  '银行卡有效期临近时请提前更新，避免还款失败。',
]

const cardThemes = [
  'from-[#2468f2] to-[#2e8cff]',
  'from-[#ff6b7f] to-[#ff8b6b]',
  'from-[#0f8b6f] to-[#28b491]',
  'from-[#6539d8] to-[#8d6cff]',
]
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

const dialogVisible = ref(false)
const adding = ref(false)
const deletingId = ref<number | null>(null)
const addForm = reactive({
  bankName: '',
  cardType: '储蓄卡',
  cardNo: '',
  owner: '',
})

function pickCardTheme(index: number) {
  if (cardThemes.length === 0) {
    return 'from-[#2468f2] to-[#2e8cff]'
  }
  return cardThemes[index % cardThemes.length] as string
}

function resetAddForm() {
  addForm.bankName = ''
  addForm.cardType = '储蓄卡'
  addForm.cardNo = ''
  addForm.owner = ''
}

async function goBack() {
  await smartNavigate('/my')
}

function handleAddCard() {
  dialogVisible.value = true
}

function closeAddDialog() {
  dialogVisible.value = false
  adding.value = false
  resetAddForm()
}

function submitAddCard() {
  const bankName = addForm.bankName.trim()
  const owner = addForm.owner.trim()
  const cardDigits = addForm.cardNo.replace(/\D/g, '')

  if (!bankName) {
    ElMessage.warning('请输入银行名称')
    return
  }
  if (!addForm.cardType.trim()) {
    ElMessage.warning('请选择银行卡类型')
    return
  }
  if (cardDigits.length < 12 || cardDigits.length > 19) {
    ElMessage.warning('请输入12-19位银行卡号')
    return
  }
  if (!owner) {
    ElMessage.warning('请输入持卡人姓名')
    return
  }
  if (!currentUserAccount.value) {
    ElMessage.warning('请先登录后再管理银行卡')
    return
  }

  adding.value = true
  createBankCard(currentUserAccount.value, {
    bankName,
    cardType: addForm.cardType,
    cardNo: cardDigits,
    owner,
  }).then(() => {
    ElMessage.success('银行卡添加成功')
    closeAddDialog()
  }).catch((error) => {
    console.error('新增银行卡失败', error)
    ElMessage.error('添加失败，请稍后重试')
  }).finally(() => {
    adding.value = false
  })
}

if (import.meta.client) {
  void syncFromStorage().then(async () => {
    if (currentUserAccount.value) {
      await fetchBankCards(currentUserAccount.value)
    }
  })
}

watch(currentUserAccount, async (account) => {
  if (!account) {
    cards.value = []
    return
  }
  await fetchBankCards(account)
})

async function handleDeleteCard(item: (typeof cards.value)[number]) {
  if (!currentUserAccount.value) {
    ElMessage.warning('请先登录后再管理银行卡')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除 ${item.bankName} 尾号 ${String(item.cardNoMasked).replace(/\s/g, '').slice(-4)} 的银行卡？`,
      '删除银行卡',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  }
  catch {
    return
  }
  deletingId.value = item.id
  try {
    await deleteBankCard(currentUserAccount.value, item.id)
    ElMessage.success('已删除银行卡')
  }
  catch (error) {
    console.error('删除银行卡失败', error)
    ElMessage.error('删除失败，请稍后重试')
  }
  finally {
    deletingId.value = null
  }
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-7">
    <div class="app-content max-w-[920px]">
      <div class="mb-5 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm text-black/65"
          @click="goBack"
        >
          <Icon
            name="tabler:chevron-left"
            size="1rem"
          />
          返回我的
        </button>
        <h1 class="text-3xl font-semibold text-black/85">
          银行卡
        </h1>
        <button
          type="button"
          class="rounded-full bg-[var(--theme-color)] px-4 py-2 text-sm text-white"
          @click="handleAddCard"
        >
          + 添加银行卡
        </button>
      </div>

      <div class="grid gap-5 md:grid-cols-2">
        <article
          v-for="item in cards"
          :key="item.id"
          class="relative overflow-hidden rounded-3xl p-6 text-white shadow-[0_12px_30px_rgba(26,55,99,0.18)]"
          :class="`bg-gradient-to-r ${pickCardTheme(cards.indexOf(item))}`"
        >
          <button
            type="button"
            class="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition hover:bg-white/30 disabled:opacity-50"
            :disabled="deletingId === item.id"
            aria-label="删除银行卡"
            @click.stop="handleDeleteCard(item)"
          >
            <Icon
              name="tabler:trash"
              size="1.1rem"
            />
          </button>
          <p class="mb-4 pr-12 text-base text-white/90">
            {{ item.bankName }}
          </p>
          <p class="mb-7 text-[1.65rem] tracking-[0.16em]">
            {{ item.cardNoMasked }}
          </p>
          <div class="flex items-center justify-between text-sm text-white/90">
            <span>{{ item.cardType }}</span>
            <span>持卡人 {{ item.owner }}</span>
          </div>
        </article>
      </div>

      <div class="mt-5 rounded-3xl bg-white p-6">
        <h2 class="mb-4 text-2xl font-semibold text-black/85">
          使用提示
        </h2>
        <ul class="space-y-2 text-base text-black/60">
          <li
            v-for="item in tips"
            :key="item"
            class="rounded-xl bg-[#f7f8fb] px-4 py-3"
          >
            {{ item }}
          </li>
        </ul>
      </div>

      <el-dialog
        v-model="dialogVisible"
        class="bank-card-dialog"
        title="添加银行卡"
        width="560px"
        destroy-on-close
        align-center
      >
        <div class="space-y-3.5">
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              银行名称
            </p>
            <el-input
              v-model="addForm.bankName"
              placeholder="例如：中国建设银行"
              clearable
              size="large"
            />
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              银行卡类型
            </p>
            <el-select
              v-model="addForm.cardType"
              class="w-full"
              size="large"
            >
              <el-option
                label="储蓄卡"
                value="储蓄卡"
              />
            </el-select>
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              银行卡号
            </p>
            <el-input
              v-model="addForm.cardNo"
              placeholder="请输入12-19位银行卡号"
              maxlength="23"
              clearable
              size="large"
            />
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              持卡人
            </p>
            <el-input
              v-model="addForm.owner"
              placeholder="请输入持卡人姓名"
              maxlength="20"
              clearable
              size="large"
            />
          </div>
        </div>

        <template #footer>
          <div class="flex items-center justify-end gap-2.5">
            <button
              type="button"
              class="dialog-btn dialog-btn-cancel"
              @click="closeAddDialog"
            >
              取消
            </button>
            <button
              type="button"
              class="dialog-btn dialog-btn-confirm"
              :disabled="adding"
              @click="submitAddCard"
            >
              {{ adding ? '添加中...' : '确认添加' }}
            </button>
          </div>
        </template>
      </el-dialog>
    </div>
  </section>
</template>

<style scoped>
.bank-card-dialog:deep(.el-dialog) {
  border-radius: 18px;
  overflow: hidden;
}

.bank-card-dialog:deep(.el-dialog__header) {
  margin-right: 0;
  padding: 16px 18px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.bank-card-dialog:deep(.el-dialog__title) {
  font-size: 22px;
  font-weight: 600;
  color: rgba(20, 20, 20, 0.85);
}

.bank-card-dialog:deep(.el-dialog__body) {
  padding: 14px 18px 8px;
  background: #fbfcff;
}

.bank-card-dialog:deep(.el-dialog__footer) {
  padding: 12px 18px 16px;
  background: #fbfcff;
}

.form-item:deep(.el-input__wrapper),
.form-item:deep(.el-select__wrapper) {
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(239, 116, 139, 0.16) inset;
}

.dialog-btn {
  height: 38px;
  min-width: 86px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
}

.dialog-btn-cancel {
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: rgba(20, 20, 20, 0.65);
  background: #fff;
}

.dialog-btn-confirm {
  border: none;
  color: #fff;
  background: linear-gradient(90deg, #0b7b6e, #18a08f);
}

.dialog-btn-confirm:disabled {
  opacity: 0.7;
}
</style>
