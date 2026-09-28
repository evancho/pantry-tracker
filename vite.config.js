import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { formatVersionLabel, taipeiDatecode } from './scripts/version-label.mjs';

function normalizeBase(input) {
  if (!input || input === '/') return '/';
  const withSlash = input.startsWith('/') ? input : `/${input}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

const base = normalizeBase(process.env.BASE_PATH);
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = pkg.version;
const appDatecode = process.env.APP_DATECODE || taipeiDatecode();
const appVersionLabel = formatVersionLabel(appVersion, appDatecode);

function appVersionHtml() {
  return {
    name: 'app-version-html',
    transformIndexHtml(html) {
      return html.replaceAll('__APP_VERSION_LABEL__', appVersionLabel);
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_DATECODE__: JSON.stringify(appDatecode),
  },
  plugins: [
    appVersionHtml(),
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
