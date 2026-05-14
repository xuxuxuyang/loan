<script setup lang="ts">
import type { UploadProps } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { donePageProgress, startPageProgress } from '../utils/progress'

import { useRoute } from 'vue-router'

type SalesMode = 'mall' | 'installment'

type ProductCategory = 'phones' | 'digital' | 'appliances' | 'cosmetics'

interface ProductItem {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  /** 商品详情页长图/多图 */
  detailImages: string[]
  category: ProductCategory
  salesMode: SalesMode
  /** 先享后付卡包/现金礼金额（元），与副标题中「价值xxxx」对应 */
  cardPackageAmount: number
  onSale: boolean
  createdAt?: string
  updatedAt?: string
}

interface ProductListPayload {
  success?: boolean
  data?: ProductItem[]
}

interface ProductPayload {
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  detailImages: string[]
  category: ProductCategory
  onSale: boolean
  salesMode: SalesMode
  cardPackageAmount: number
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const PRODUCTS_ENDPOINT = `${MALL_API_BASE}/products`

const route = useRoute()
const salesMode = computed<SalesMode>(() =>
  route.path.includes('installment') ? 'installment' : 'mall',
)

const products = ref<ProductItem[]>([])
const loading = ref(false)
const submitting = ref(false)
const imageCompressing = ref(false)
const PRODUCT_DETAIL_IMAGE_MAX = 24
const detailImageCompressing = ref(false)

/** 商品主图：限制长边、转 JPEG，避免 base64 过大导致保存失败 */
const PRODUCT_IMAGE_MAX_EDGE = 1600
const PRODUCT_IMAGE_JPEG_QUALITY = 0.86

function drawProductImageToJpegDataUrl(source: CanvasImageSource, sw: number, sh: number, quality: number): string {
  const scale = Math.min(1, PRODUCT_IMAGE_MAX_EDGE / Math.max(sw, sh))
  const cw = Math.max(1, Math.round(sw * scale))
  const ch = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('canvas')
  }
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', quality)
}

async function compressProductImageFileToDataUrl(file: File): Promise<string> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        return drawProductImageToJpegDataUrl(bitmap, bitmap.width, bitmap.height, PRODUCT_IMAGE_JPEG_QUALITY)
      }
      finally {
        bitmap.close()
      }
    }
    catch {
      // HEIC 等可能失败，走 Image 解码
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        resolve(drawProductImageToJpegDataUrl(img, img.naturalWidth, img.naturalHeight, PRODUCT_IMAGE_JPEG_QUALITY))
      }
      catch (e) {
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法解析，请换 JPG/PNG/WebP 重试'))
    }
    img.src = url
  })
}

async function processProductCoverFile(file: File): Promise<string> {
  try {
    const dataUrl = await compressProductImageFileToDataUrl(file)
    const blob = dataUrlToBlob(dataUrl)
    const uploadFile = new File([blob], `product_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
    const fd = new FormData()
    fd.append('image', uploadFile)
    fd.append('biz', 'product')
    fd.append('scene', 'cover')
    const response = await fetch(`${MALL_API_BASE}/uploads/public-image`, {
      method: 'POST',
      headers: withAdminAuthHeaders(),
      body: fd,
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: { url?: string } }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `图片上传失败: ${response.status}`)
    }
    const url = String(payload.data?.url || '').trim()
    if (!url) {
      throw new Error('图片上传失败：未返回 URL')
    }
    return url
  }
  catch (e) {
    console.warn('[ProductsPage] compress/upload failed', e)
    throw e
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = String(dataUrl || '').split(',')
  if (parts.length < 2) {
    throw new Error('图片处理失败，请重试')
  }
  const mime = /data:(.*?);base64/.exec(parts[0] || '')?.[1] || 'image/jpeg'
  const binary = atob(parts[1])
  const len = binary.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    u8[i] = binary.charCodeAt(i)
  }
  return new Blob([u8], { type: mime })
}

const onProductCoverChange: UploadProps['onChange'] = async (uploadFile) => {
  const raw = uploadFile.raw
  if (!raw) {
    return
  }
  imageCompressing.value = true
  try {
    form.image = await processProductCoverFile(raw)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '图片处理失败，请重新选择')
  }
  finally {
    imageCompressing.value = false
  }
}

const onDetailImagesChange: UploadProps['onChange'] = async (uploadFile) => {
  const raw = uploadFile.raw
  if (!raw) {
    return
  }
  if (form.detailImages.length >= PRODUCT_DETAIL_IMAGE_MAX) {
    ElMessage.warning(`商品详情图最多 ${PRODUCT_DETAIL_IMAGE_MAX} 张`)
    return
  }
  detailImageCompressing.value = true
  try {
    const dataUrl = await compressProductImageFileToDataUrl(raw)
    const blob = dataUrlToBlob(dataUrl)
    const uploadFile = new File([blob], `detail_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
    const fd = new FormData()
    fd.append('image', uploadFile)
    fd.append('biz', 'product')
    fd.append('scene', 'detail')
    const response = await fetch(`${MALL_API_BASE}/uploads/public-image`, {
      method: 'POST',
      headers: withAdminAuthHeaders(),
      body: fd,
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: { url?: string } }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `详情图上传失败: ${response.status}`)
    }
    const url = String(payload.data?.url || '').trim()
    if (!url) {
      throw new Error('详情图上传失败：未返回 URL')
    }
    form.detailImages.push(url)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '详情图处理失败，请重新选择')
  }
  finally {
    detailImageCompressing.value = false
  }
}

function removeDetailImage(index: number) {
  form.detailImages.splice(index, 1)
}

function clearProductCover() {
  form.image = ''
}
const deletingId = ref<number | null>(null)
const pendingDeleteId = ref<number | null>(null)
const keyword = ref('')
const categoryFilter = ref<'all' | ProductCategory>('all')
const saleFilter = ref<'all' | 'on' | 'off'>('all')
const editingId = ref<number | null>(null)
const showEditor = ref(false)

const categoryOptions: Array<{ value: ProductCategory, label: string }> = [
  { value: 'phones', label: '手机' },
  { value: 'digital', label: '数码产品' },
  { value: 'appliances', label: '家用电器' },
  { value: 'cosmetics', label: '化妆品' },
]

const form = reactive<ProductPayload>({
  name: '',
  subtitle: '',
  description: '',
  origin: '',
  price: 0,
  image: '',
  detailImages: [],
  category: 'phones',
  onSale: true,
  salesMode: 'mall',
  cardPackageAmount: 0,
})

const categoryLabelMap = computed(() => {
  return Object.fromEntries(categoryOptions.map(item => [item.value, item.label]))
})

const filteredProducts = computed(() => {
  const searchKey = keyword.value.trim()
  const list = products.value.filter((item) => {
    if (salesMode.value === 'mall' && categoryFilter.value !== 'all' && item.category !== categoryFilter.value) {
      return false
    }
    if (saleFilter.value === 'on' && !item.onSale) {
      return false
    }
    if (saleFilter.value === 'off' && item.onSale) {
      return false
    }
    if (!searchKey) {
      return true
    }
    const capStr = String(item.cardPackageAmount ?? '')
    return item.name.includes(searchKey) || item.subtitle.includes(searchKey) || item.origin.includes(searchKey) || capStr.includes(searchKey)
  })
  if (salesMode.value === 'installment') {
    return [...list].sort((a, b) => a.price - b.price)
  }
  return list
})

function normalizeProduct(item: Partial<ProductItem>): ProductItem {
  const category = categoryOptions.some(option => option.value === item.category)
    ? item.category as ProductCategory
    : 'phones'
  return {
    id: Number(item.id || 0),
    name: String(item.name || ''),
    subtitle: String(item.subtitle || ''),
    description: String(item.description || ''),
    origin: String(item.origin || ''),
    price: Number(item.price || 0),
    image: String(item.image || ''),
    detailImages: Array.isArray(item.detailImages)
      ? item.detailImages.map(s => String(s || '').trim()).filter(Boolean)
      : [],
    category,
    salesMode: item.salesMode === 'mall' ? 'mall' : 'installment',
    cardPackageAmount: Math.max(0, Math.round(Number(item.cardPackageAmount) || 0)),
    onSale: typeof item.onSale === 'boolean' ? item.onSale : true,
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
  }
}

function resetForm() {
  form.name = ''
  form.subtitle = ''
  form.description = ''
  form.origin = ''
  form.price = 0
  form.image = ''
  form.detailImages.splice(0, form.detailImages.length)
  form.category = 'phones'
  form.onSale = true
  form.salesMode = salesMode.value
  form.cardPackageAmount = 0
}

function openCreate() {
  editingId.value = null
  resetForm()
  showEditor.value = true
}

function openEdit(item: ProductItem) {
  editingId.value = item.id
  form.name = item.name
  form.subtitle = item.subtitle
  form.description = item.description
  form.origin = item.origin
  form.price = item.price
  form.image = item.image
  form.detailImages = [...(item.detailImages || [])]
  form.category = item.category
  form.onSale = item.onSale
  form.salesMode = item.salesMode
  form.cardPackageAmount = item.cardPackageAmount ?? 0
  showEditor.value = true
}

function closeEditor() {
  showEditor.value = false
  editingId.value = null
  resetForm()
}

/** 先享后付副标题固定格式（与卡包金额联动） */
function buildInstallmentGiftSubtitle(amount: number): string {
  const n = Math.max(0, Math.round(Number(amount) || 0))
  return `赠送价值${n}现金卡包`
}

function syncInstallmentGiftSubtitle() {
  if (salesMode.value !== 'installment' || !showEditor.value)
    return
  form.subtitle = buildInstallmentGiftSubtitle(form.cardPackageAmount)
}

watch(
  () => [showEditor.value, salesMode.value, form.cardPackageAmount] as const,
  () => syncInstallmentGiftSubtitle(),
)

function validateForm() {
  if (!form.name.trim() || !form.subtitle.trim() || !form.description.trim() || !form.origin.trim() || !form.image.trim()) {
    ElMessage.warning('请完善商品名称、副标题、描述、产地并上传商品主图')
    return false
  }
  if (!Number.isFinite(form.price) || form.price <= 0) {
    ElMessage.warning('价格必须大于 0')
    return false
  }
  if (salesMode.value === 'installment') {
    const cap = Number(form.cardPackageAmount)
    if (!Number.isFinite(cap) || cap < 0) {
      ElMessage.warning('卡包金额须为非负整数（元）')
      return false
    }
  }
  return true
}

function buildPayload(): ProductPayload {
  const cap = Math.max(0, Math.round(Number(form.cardPackageAmount) || 0))
  const subtitleOut = salesMode.value === 'installment'
    ? buildInstallmentGiftSubtitle(cap)
    : form.subtitle.trim()
  return {
    name: form.name.trim(),
    subtitle: subtitleOut,
    description: form.description.trim(),
    origin: form.origin.trim(),
    image: form.image.trim(),
    detailImages: [...form.detailImages],
    price: Number(form.price),
    category: form.category,
    onSale: form.onSale,
    salesMode: salesMode.value,
    cardPackageAmount: salesMode.value === 'installment' ? cap : 0,
  }
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

async function fetchProducts() {
  loading.value = true
  startPageProgress()
  try {
    const query = new URLSearchParams()
    query.set('includeAll', '1')
    query.set('salesMode', salesMode.value)
    const response = await fetch(`${PRODUCTS_ENDPOINT}?${query.toString()}`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`请求商品失败: ${response.status}`)
    }
    const payload = await response.json() as ProductListPayload
    products.value = Array.isArray(payload.data) ? payload.data.map(normalizeProduct) : []
  }
  catch (error) {
    console.error('读取商品失败', error)
    products.value = []
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

async function submitForm() {
  if (submitting.value) {
    return
  }
  if (!validateForm()) {
    return
  }

  submitting.value = true
  const method = editingId.value ? 'PATCH' : 'POST'
  const url = editingId.value ? `${PRODUCTS_ENDPOINT}/${editingId.value}` : PRODUCTS_ENDPOINT
  try {
    const response = await fetch(url, {
      method,
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildPayload()),
    })
    if (!response.ok) {
      throw new Error(`保存商品失败: ${response.status}`)
    }
    await fetchProducts()
    closeEditor()
  }
  catch (error) {
    console.error('保存商品失败', error)
    ElMessage.error('保存商品失败，请稍后重试')
  }
  finally {
    submitting.value = false
  }
}

async function toggleOnSale(item: ProductItem) {
  try {
    const response = await fetch(`${PRODUCTS_ENDPOINT}/${item.id}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ onSale: !item.onSale }),
    })
    if (!response.ok) {
      throw new Error(`更新上架状态失败: ${response.status}`)
    }
    await fetchProducts()
  }
  catch (error) {
    console.error('更新上架状态失败', error)
    ElMessage.error('更新上架状态失败，请稍后重试')
  }
}

function toggleDeleteConfirm(productId: number) {
  if (pendingDeleteId.value === productId) {
    pendingDeleteId.value = null
    return
  }
  pendingDeleteId.value = productId
}

function cancelDelete() {
  pendingDeleteId.value = null
}

async function removeProduct(item: ProductItem) {
  if (deletingId.value) {
    return
  }
  deletingId.value = item.id
  try {
    const response = await fetch(`${PRODUCTS_ENDPOINT}/${item.id}`, {
      method: 'DELETE',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`删除商品失败: ${response.status}`)
    }
    pendingDeleteId.value = null
    await fetchProducts()
  }
  catch (error) {
    console.error('删除商品失败', error)
    ElMessage.error('删除商品失败，请稍后重试')
  }
  finally {
    deletingId.value = null
  }
}

onMounted(() => {
  void fetchProducts()
})

watch(salesMode, () => {
  categoryFilter.value = 'all'
  void fetchProducts()
})
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索商品名称 / 副标题 / 产地 / 卡包金额"
        clearable
      />
      <el-select
        v-if="salesMode === 'mall'"
        v-model="categoryFilter"
        class="pretty-select toolbar-select"
        popper-class="admin-select-popper"
      >
        <el-option
          label="全部分类"
          value="all"
        />
        <el-option
          v-for="item in categoryOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select
        v-model="saleFilter"
        class="pretty-select toolbar-select"
        popper-class="admin-select-popper"
      >
        <el-option
          label="全部状态"
          value="all"
        />
        <el-option
          label="已上架"
          value="on"
        />
        <el-option
          label="已下架"
          value="off"
        />
      </el-select>
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="fetchProducts"
      >
        刷新
      </button>
      <button
        class="btn btn-primary"
        type="button"
        @click="openCreate"
      >
        新增商品
      </button>
    </div>

    <div class="products-table-wrap">
      <table class="table products-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>商品图</th>
          <th>商品信息</th>
          <th>{{ salesMode === 'installment' ? '专区' : '分类' }}</th>
          <th>价格</th>
          <th v-if="salesMode === 'installment'">
            卡包金额
          </th>
          <th>状态</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredProducts"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td class="products-table__thumb">
            <img
              :src="item.image"
              :alt="item.name"
              class="product-image"
            >
          </td>
          <td class="products-table__info">
            <p class="name">
              {{ item.name }}
            </p>
            <p class="sub">
              {{ item.subtitle }}
            </p>
            <p class="sub">
              产地：{{ item.origin }}
            </p>
            <p
              v-if="item.detailImages?.length"
              class="sub"
            >
              详情图：{{ item.detailImages.length }} 张
            </p>
          </td>
          <td>{{ salesMode === 'installment' ? '先享后付' : categoryLabelMap[item.category] }}</td>
          <td>¥ {{ item.price.toFixed(2) }}</td>
          <td v-if="salesMode === 'installment'">
            ¥ {{ item.cardPackageAmount.toFixed(0) }}
          </td>
          <td>
            <span :class="item.onSale ? 'badge badge-on' : 'badge badge-off'">
              {{ item.onSale ? '已上架' : '已下架' }}
            </span>
          </td>
          <td>{{ formatDateTime(item.updatedAt || item.createdAt) }}</td>
          <td>
            <div class="actions">
              <button
                class="btn btn-primary"
                type="button"
                @click="openEdit(item)"
              >
                编辑
              </button>
              <button
                class="btn btn-warning"
                type="button"
                @click="toggleOnSale(item)"
              >
                {{ item.onSale ? '下架' : '上架' }}
              </button>
              <div class="delete-wrap">
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="Boolean(deletingId) && deletingId !== item.id"
                  @click="toggleDeleteConfirm(item.id)"
                >
                  {{ deletingId === item.id ? '删除中...' : '删除' }}
                </button>
                <div
                  v-if="pendingDeleteId === item.id"
                  class="delete-pop"
                >
                  <p>确定删除该商品？</p>
                  <div class="delete-pop-actions">
                    <button
                      class="btn btn-danger"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="removeProduct(item)"
                    >
                      删除
                    </button>
                    <button
                      class="btn btn-ghost"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="cancelDelete"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredProducts.length === 0">
          <td
            :colspan="salesMode === 'installment' ? 9 : 8"
            style="text-align: center; color: #9ca3af;"
          >
            暂无商品数据
          </td>
        </tr>
      </tbody>
      </table>
    </div>
  </div>

  <div
    v-if="showEditor"
    class="modal-mask"
    @click.self="closeEditor"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>{{ editingId ? '编辑商品' : '新增商品' }}</h3>
        <button
          type="button"
          class="btn"
          @click="closeEditor"
        >
          关闭
        </button>
      </div>

      <div class="form-grid">
        <label>
          商品名称
          <el-input
            v-model="form.name"
            class="form-input"
            clearable
          />
        </label>
        <label v-if="salesMode === 'mall'">
          副标题
          <el-input
            v-model="form.subtitle"
            class="form-input"
            clearable
          />
        </label>
        <label
          v-else
          class="subtitle-auto-label"
        >
          副标题
          <el-input
            :model-value="form.subtitle"
            class="form-input subtitle-generated"
            disabled
            readonly
          />
        </label>
        <label v-if="salesMode === 'mall'">
          商品分类
          <el-select
            v-model="form.category"
            class="pretty-select form-select"
            popper-class="admin-select-popper"
          >
            <el-option
              v-for="item in categoryOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </label>
        <label v-else>
          前台专区
          <el-input
            class="form-input"
            :model-value="'先享后付'"
            disabled
          />
        </label>
        <label>
          产地
          <el-input
            v-model="form.origin"
            class="form-input"
            clearable
          />
        </label>
        <template v-if="salesMode === 'mall'">
          <label>
            价格
            <el-input-number
              v-model="form.price"
              class="form-input-number form-input-number--fill"
              :min="0"
              :step="0.01"
              :controls="false"
            />
          </label>
        </template>
        <div
          v-else
          class="installment-price-row"
        >
          <label class="form-field-compact">
            价格
            <el-input-number
              v-model="form.price"
              class="form-input-number form-input-number--fill"
              :min="0"
              :step="0.01"
              :controls="false"
            />
          </label>
          <label class="form-field-compact">
            卡包金额（元）
            <el-input-number
              v-model="form.cardPackageAmount"
              class="form-input-number form-input-number--fill"
              :min="0"
              :step="1"
              :precision="0"
              :controls="false"
            />
          </label>
        </div>
        <label>
          上架状态
          <el-select
            v-model="form.onSale"
            class="pretty-select form-select"
            popper-class="admin-select-popper"
          >
            <el-option
              label="上架"
              :value="true"
            />
            <el-option
              label="下架"
              :value="false"
            />
          </el-select>
        </label>
        <label class="full">
          商品主图
          <div class="cover-upload-row">
            <el-upload
              class="cover-upload"
              :auto-upload="false"
              accept="image/jpeg,image/png,image/webp,image/gif"
              :show-file-list="false"
              :disabled="imageCompressing"
              @change="onProductCoverChange"
            >
              <el-button
                type="primary"
                plain
                :loading="imageCompressing"
              >
                {{ imageCompressing ? '处理中…' : '选择本地图片' }}
              </el-button>
            </el-upload>
            <button
              v-if="form.image"
              type="button"
              class="btn btn-ghost cover-remove"
              :disabled="imageCompressing"
              @click="clearProductCover"
            >
              移除图片
            </button>
          </div>
          <div
            v-if="form.image"
            class="cover-preview-wrap"
          >
            <img
              :src="form.image"
              alt="主图预览"
              class="cover-preview"
            >
          </div>
        </label>
        <label class="full">
          商品详情图
          <div class="cover-upload-row">
            <el-upload
              class="cover-upload"
              :auto-upload="false"
              accept="image/jpeg,image/png,image/webp,image/gif"
              :show-file-list="false"
              multiple
              :disabled="detailImageCompressing || form.detailImages.length >= PRODUCT_DETAIL_IMAGE_MAX"
              @change="onDetailImagesChange"
            >
              <el-button
                type="primary"
                plain
                :loading="detailImageCompressing"
                :disabled="form.detailImages.length >= PRODUCT_DETAIL_IMAGE_MAX"
              >
                {{ detailImageCompressing ? '处理中…' : '添加详情图' }}
              </el-button>
            </el-upload>
            <span class="detail-count-hint">已选 {{ form.detailImages.length }} / {{ PRODUCT_DETAIL_IMAGE_MAX }} 张</span>
          </div>
          <div
            v-if="form.detailImages.length"
            class="detail-preview-grid"
          >
            <div
              v-for="(url, idx) in form.detailImages"
              :key="`${idx}-${url.slice(0, 24)}`"
              class="detail-preview-cell"
            >
              <img
                :src="url"
                :alt="`详情图 ${idx + 1}`"
                class="detail-preview-img"
              >
              <button
                type="button"
                class="btn btn-ghost detail-preview-remove"
                @click="removeDetailImage(idx)"
              >
                移除
              </button>
            </div>
          </div>
        </label>
        <label class="full">
          商品描述
          <el-input
            v-model="form.description"
            class="form-textarea"
            type="textarea"
            :rows="3"
          />
        </label>
      </div>

      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="submitting || imageCompressing || detailImageCompressing"
          @click="submitForm"
        >
          {{ submitting ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
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

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-secondary {
  border-color: #9ca3af;
  background: #f8fafc;
  color: #374151;
}

.btn-warning {
  border-color: #d97706;
  background: #d97706;
  color: #fff;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-ghost {
  color: #374151;
}

.actions-right {
  justify-content: flex-end;
  margin-top: 12px;
}

.toolbar-input {
  width: 260px;
  max-width: 100%;
}

.toolbar-select {
  width: 148px;
}

.channel-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.pretty-select {
  --el-color-primary: #2563eb;
}

:deep(.pretty-select .el-select__wrapper) {
  min-height: 36px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  box-shadow: none;
  background: linear-gradient(180deg, #fff, #f8fbff);
}

:deep(.pretty-select .el-select__wrapper.is-focused) {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

:deep(.pretty-select .el-select__selected-item) {
  color: #1f2937;
  font-size: 14px;
}

:global(.admin-select-popper) {
  border-radius: 10px;
  border: 1px solid #dbeafe;
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.18);
}

:global(.admin-select-popper .el-select-dropdown__item.is-selected) {
  color: #1d4ed8;
  background: #eff6ff;
  font-weight: 600;
}

:global(.admin-select-popper .el-select-dropdown__item:hover) {
  background: #f0f9ff;
}

.product-image {
  width: 72px;
  height: 52px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  object-fit: cover;
}

.name {
  margin: 0 0 4px;
  font-weight: 600;
  color: #111827;
}

.sub {
  margin: 0;
  color: #a8a1a1;
  font-size: 12px;
}

.badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.badge-on {
  background: #dcfce7;
  color: #166534;
}

.badge-off {
  background: #fee2e2;
  color: #991b1b;
}

.delete-wrap {
  position: relative;
}

.delete-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
  padding: 10px;
  z-index: 30;
}

.delete-pop p {
  margin: 0;
  color: #374151;
  font-size: 13px;
}

.delete-pop-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.delete-pop-actions .btn {
  width: 100%;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
  width: 760px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.modal-header h3 {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
}

.form-grid .full {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid select,
.form-grid textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}

.form-grid input,
.form-grid select {
  height: 36px;
}

.form-select {
  width: 100%;
}

.form-input,
.form-textarea {
  width: 100%;
}

.form-input-number {
  width: 100%;
}

.form-input-number--fill {
  width: 100%;
}

.form-input-number--fill :deep(.el-input-number) {
  width: 100%;
}

.form-input-number--fill :deep(.el-input-number .el-input__wrapper) {
  width: 100%;
}

.installment-price-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.installment-price-row .form-field-compact {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
  min-width: 0;
}

.subtitle-generated :deep(.el-input__wrapper) {
  background-color: #f9fafb;
  box-shadow: 0 0 0 1px #e5e7eb inset;
}

.subtitle-auto-label .field-hint {
  margin-top: 4px;
}

.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.45;
}

.form-grid textarea {
  resize: vertical;
}

.cover-upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.cover-upload :deep(.el-upload) {
  display: inline-block;
}

.cover-remove {
  height: 32px;
}

.cover-upload-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.45;
}

.cover-preview-wrap {
  margin-top: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
  background: #f9fafb;
  display: inline-block;
  max-width: 100%;
}

.cover-preview {
  display: block;
  max-width: min(360px, 100%);
  max-height: 220px;
  object-fit: contain;
  border-radius: 6px;
}

.detail-count-hint {
  font-size: 13px;
  color: #64748b;
  align-self: center;
}

.detail-preview-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.detail-preview-cell {
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px;
  background: #f9fafb;
}

.detail-preview-img {
  display: block;
  width: 100%;
  height: 100px;
  object-fit: contain;
  border-radius: 4px;
}

.detail-preview-remove {
  margin-top: 6px;
  width: 100%;
  font-size: 12px;
}

/* 列表区域：横向溢出时在此容器内滚动，避免表格外层布局被撑乱、行背景错位 */
.products-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.products-table {
  width: 100%;
  min-width: 1040px;
}

.products-table th {
  background: #fafafa;
}

.products-table tbody td {
  background-color: #fff;
}

.products-table tbody tr:hover td {
  background-color: #fff;
}

.products-table td.products-table__thumb {
  vertical-align: middle;
  white-space: nowrap;
}

.products-table td.products-table__info {
  min-width: 140px;
  max-width: 420px;
  word-break: break-word;
  overflow-wrap: anywhere;
  vertical-align: top;
}

.products-table td:last-child {
  vertical-align: middle;
}

.products-table .actions {
  flex-wrap: wrap;
  max-width: 280px;
}
</style>
