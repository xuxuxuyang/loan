import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

const epResolver = ElementPlusResolver({ importStyle: 'sass' })
const elementPlusFormKeys = [
  '/element-plus/es/components/input/',
  '/element-plus/es/components/select/',
  '/element-plus/es/components/option/',
  '/element-plus/es/components/dialog/',
  '/element-plus/es/components/switch/',
  '/element-plus/es/components/upload/',
  '/element-plus/es/components/cascader/',
  '/element-plus/es/components/form/',
  '/element-plus/es/components/form-item/',
  '/element-plus/es/components/checkbox/',
  '/element-plus/es/components/radio/',
  '/element-plus/es/components/message-box/',
]
const elementChinaAreaDataKeys = [
  '/element-china-area-data/',
]

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3110',
        changeOrigin: true,
      },
      /** 客服图片等静态资源由 mall-api 提供（与 /api 同源部署时生产环境走网关即可） */
      '/static': {
        target: process.env.SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3110',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        {
          '@/spa-shim': [
            'useCookie',
            'useState',
            'useRuntimeConfig',
            '$fetch',
          ],
        },
      ],
      dirs: ['./src/composables'],
      resolvers: [epResolver],
      dts: 'src/auto-imports.d.ts',
      vueTemplate: true,
    }),
    Components({
      resolvers: [epResolver],
      dirs: ['src/components'],
      dts: 'src/components.d.ts',
    }),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@use "@/assets/styles/element.scss" as element;',
      },
    },
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const n = id.replaceAll('\\', '/')
          if (elementChinaAreaDataKeys.some(key => n.includes(key))) {
            return 'vendor-region-data'
          }
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('vue-router')) {
              return 'vendor-vue'
            }
            if (id.includes('element-plus') || id.includes('@element-plus')) {
              if (elementPlusFormKeys.some(key => id.includes(key))) {
                return 'vendor-element-plus-form'
              }
              return 'vendor-element-plus'
            }
            return 'vendor'
          }
          if (id.includes('/src/components/order/') || id.includes('/src/composables/useMallOrders')) {
            return 'feature-order'
          }
          if (id.includes('/src/components/my/address/AddressEditorDialog.vue') || id.includes('element-china-area-data')) {
            return 'feature-my-address-editor'
          }
          if (id.includes('/src/components/my/address/') || id.includes('/src/composables/useMallMy')) {
            return 'feature-my-address'
          }
          if (id.includes('/src/components/my/bill/')) {
            return 'feature-my-bill'
          }
          if (id.includes('/src/components/my/card-package/dialogs/')) {
            return 'feature-my-card-package-dialogs'
          }
          if (id.includes('/src/components/my/card-package/') || id.includes('/src/components/my/CardPackageSection.vue')) {
            return 'feature-my-card-package'
          }
          if (id.includes('/src/components/my/bank-card/')) {
            return 'feature-my-bank-card'
          }
          if (id.includes('/src/components/my/order/')) {
            return 'feature-my-order'
          }
          if (id.includes('/src/components/my/')) {
            return 'feature-my-base'
          }
          if (id.includes('/src/components/mall/') || id.includes('/src/composables/useTeaProducts')) {
            return 'feature-mall'
          }
        },
      },
    },
  },
})
