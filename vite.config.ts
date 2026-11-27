import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    manifest: {
      name: '学院论文审核本地工作台', short_name: '论文审核', lang: 'zh-CN',
      theme_color: '#fbf8f2', background_color: '#f6f3ed', display: 'standalone',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,mjs,css,html,svg,jpg,json,pdf,docx,wasm,bcmap,pfb,ttf}'],
      maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      navigateFallbackDenylist: [/\/models\//],
    },
  })],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 3000 },
});
