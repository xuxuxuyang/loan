import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

const epResolver = ElementPlusResolver({ importStyle: 'sass' })

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
})
