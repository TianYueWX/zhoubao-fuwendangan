import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  // 关键:相对路径 base 同时兼容 file:// 与子路径部署(Cloudflare Pages)
  base: './',

  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 由脚本/调用方负责清理 dist,绕过 Vite 自身 emptyDir 触发的
    // safe-delete(trash) 在沙箱里偶发的 abort,内容用 hash,旧文件保留无副作用。
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // ECharts 单图按需引入后仍有 ~250KB,单独拆 chunk 便于 Cloudflare 长期缓存
        manualChunks: {
          echarts: ['echarts'],
          vendor: ['vue', 'papaparse']
        }
      }
    }
  },

  server: {
    port: 5173,
    open: false
  },

  preview: {
    port: 4173
  },

  optimizeDeps: {
    include: ['echarts', 'papaparse', 'vue']
  }
});
