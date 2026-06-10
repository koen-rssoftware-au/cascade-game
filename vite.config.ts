import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in main.ts, web only (not in the Capacitor shell)
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Cascade',
        short_name: 'Cascade',
        description: 'Drag-and-drop block puzzle with gravity cascades',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1026',
        theme_color: '#0b1026',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
