import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { handleCardImage } from './functions/api/cardmaker/_image';
import type { Connect } from 'vite';

// Use the same restricted image relay locally and in Cloudflare Pages.
const cardImageMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  const path = req.url ?? '';
  if (!path.startsWith('/api/cardmaker/image?') || req.method !== 'GET') { next(); return; }
  void handleCardImage(new Request(`http://localhost${path}`)).then(async response => {
    res.statusCode = response.status; response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).catch(() => { res.statusCode = 502; res.end('Card image unavailable'); });
};

const riftboundProxy = {
  target: 'https://lol-api.playloltcg.com',
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(/^\/api\/riftbound/, '/xcx')
};

// 官网卡表（Riot PCS）：CORS 只放行 playriftbound.com，dev 下同样走同源路径。
const galleryUpstream =
  'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list';
const galleryProxy = (list: string) => ({
  target: 'https://content.publishing.riotgames.com',
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) =>
    path.replace(/^\/api\/riftbound\/gallery\/[^?]+/, `${galleryUpstream}/riftbound_gallery_${list}`)
});

// https://vitejs.dev/config/
export default defineConfig({
  // 关键:相对路径 base 同时兼容 file:// 与子路径部署(Cloudflare Pages)
  base: './',

  plugins: [vue(), { name: 'cardmaker-image', configureServer(server) { server.middlewares.use(cardImageMiddleware); }, configurePreviewServer(server) { server.middlewares.use(cardImageMiddleware); } }],
  worker: { format: 'es' },

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
    open: false,
    proxy: {
      '/api/riftbound/gallery/cards': galleryProxy('cards'),
      '/api/riftbound/gallery/sets': galleryProxy('sets'),
      '/api/riftbound': riftboundProxy
    }
  },

  preview: {
    port: 4173,
    proxy: {
      '/api/riftbound/gallery/cards': galleryProxy('cards'),
      '/api/riftbound/gallery/sets': galleryProxy('sets'),
      '/api/riftbound': riftboundProxy
    }
  },

  optimizeDeps: {
    include: ['echarts', 'papaparse', 'vue']
  }
});
