import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    Components({
      dts: 'src/components.d.ts',
      resolvers: [ElementPlusResolver()],
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const n = id.replaceAll('\\', '/')
          if (n.includes('@element-plus/icons-vue')) {
            return 'vendor-element-icons'
          }
          if (n.includes('element-plus')) {
            // 按组件族拆分，避免单一 element-plus chunk 过大
            if (
              n.includes('/components/table/')
              || n.includes('/components/pagination/')
              || n.includes('/components/scrollbar/')
              || n.includes('/components/empty/')
            ) {
              return 'vendor-element-data'
            }
            if (
              n.includes('/components/form/')
              || n.includes('/components/input/')
              || n.includes('/components/input-number/')
              || n.includes('/components/select/')
              || n.includes('/components/option/')
              || n.includes('/components/checkbox/')
              || n.includes('/components/radio/')
              || n.includes('/components/switch/')
              || n.includes('/components/upload/')
              || n.includes('/components/dialog/')
              || n.includes('/components/message/')
              || n.includes('/components/message-box/')
              || n.includes('/components/tooltip/')
              || n.includes('/components/popover/')
              || n.includes('/components/dropdown/')
            ) {
              return 'vendor-element-form'
            }
            return 'vendor-element-base'
          }
          if (n.includes('/@vue/') || n.includes('/vue/') || n.includes('vue-router')) {
            return 'vendor-vue'
          }
          if (n.includes('echarts') || n.includes('zrender')) {
            return 'vendor-echarts'
          }
          if (n.includes('/node_modules/')) {
            return 'vendor'
          }
          if (n.includes('/src/views/CsMessagesPage.vue')) {
            return 'feature-cs'
          }
        },
      },
    },
  },
})
