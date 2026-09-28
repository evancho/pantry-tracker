import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function normalizeBase(input) {
  if (!input || input === '/') return '/';
  const withSlash = input.startsWith('/') ? input : `/${input}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

const base = normalizeBase(process.env.BASE_PATH);

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [
        'favicon.svg',
        'icons/*.png',
        'tessdata/*.gz',
      ],
      manifest: {
        name: '食材櫃',
        short_name: '食材櫃',
        description: '家用食材與保存期限追蹤。資料只存在這台裝置。',
        lang: 'zh-TW',
        dir: 'ltr',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f3efe6',
        theme_color: '#1d5c42',
        categories: ['food', 'lifestyle'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,gz}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
