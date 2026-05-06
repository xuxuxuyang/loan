<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

interface BankCardItem {
  id: number
  bankName: string
  cardType: string
  cardNo: string
  owner: string
  theme: string
}

interface AddCardForm {
  bankName: string
  cardType: string
  cardNo: string
  owner: string
}

const cards = ref<BankCardItem[]>([
  {
    id: 1,
    bankName: '中国建设银行',
    cardType: '储蓄卡',
    cardNo: '**** **** **** 6218',
    owner: '张**',
    theme: 'from-[#2468f2] to-[#2e8cff]',
  },
  {
    id: 2,
    bankName: '招商银行',
    cardType: '储蓄卡',
    cardNo: '**** **** **** 8893',
    owner: '张**',
    theme: 'from-[#ff6b7f] to-[#ff8b6b]',
  },
])

const dialogVisible = ref(false)
const adding = ref(false)
const addForm = reactive<AddCardForm>({
  bankName: '',
  cardType: '储蓄卡',
  cardNo: '',
  owner: '',
})

const cardThemes = [
  'from-[#2468f2] to-[#2e8cff]',
  'from-[#ff6b7f] to-[#ff8b6b]',
  'from-[#0f8b6f] to-[#28b491]',
  'from-[#6539d8] to-[#8d6cff]',
]

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

function maskOwnerName(name: string) {
  const cleanName = name.trim()
  if (!cleanName) {
    return ''
  }
  if (cleanName.length === 1) {
    return `${cleanName}*`
  }
  return `${cleanName[0]}${'*'.repeat(Math.min(2, cleanName.length - 1))}`
}

function maskCardNumber(rawCardNo: string) {
  const digits = rawCardNo.replace(/\D/g, '')
  const last4 = digits.slice(-4).padStart(4, '*')
  return `**** **** **** ${last4}`
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

  adding.value = true
  cards.value.unshift({
    id: Date.now(),
    bankName,
    cardType: addForm.cardType,
    cardNo: maskCardNumber(cardDigits),
    owner: maskOwnerName(owner),
    theme: pickCardTheme(cards.value.length),
  })
  adding.value = false
  closeAddDialog()
  ElMessage.success('银行卡添加成功')
}
</script>

<template>
  <section class="px-4 pb-5 pt-4">
    <div class="mb-3 flex items-center justify-between">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black/60"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="text-xl font-semibold text-black/85">
        我的银行卡
      </h1>
      <div class="w-9" />
    </div>

    <article
      v-for="item in cards"
      :key="item.id"
      class="mb-3 overflow-hidden rounded-2xl p-4 text-white shadow-[0_10px_24px_rgba(26,55,99,0.16)]"
      :class="`bg-gradient-to-r ${item.theme}`"
    >
      <p class="mb-3 text-sm text-white/85">
        {{ item.bankName }}
      </p>
      <p class="mb-4 text-xl tracking-[0.14em]">
        {{ item.cardNo }}
      </p>
      <div class="flex items-center justify-between text-xs text-white/85">
        <span>{{ item.cardType }}</span>
        <span>持卡人 {{ item.owner }}</span>
      </div>
    </article>

    <button
      type="button"
      class="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-black/18 bg-white py-3 text-sm text-black/65"
      @click="handleAddCard"
    >
      <Icon
        name="tabler:plus"
        size="1rem"
      />
      添加新银行卡
    </button>

    <el-dialog
      v-model="dialogVisible"
      class="bank-card-dialog"
      title="添加银行卡"
      width="90%"
      destroy-on-close
      align-center
    >
      <div class="space-y-3.5">
        <div class="form-item">
          <p class="mb-1.5 text-xs text-black/50">
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
          <p class="mb-1.5 text-xs text-black/50">
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
          <p class="mb-1.5 text-xs text-black/50">
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
          <p class="mb-1.5 text-xs text-black/50">
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
  font-size: 21px;
  font-weight: 600;
  color: rgba(20, 20, 20, 0.85);
}

.bank-card-dialog:deep(.el-dialog__body) {
  padding: 14px 18px 6px;
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
