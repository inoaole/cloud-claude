import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Hub origin for the dev proxy — keeps /auth, /api, /pty same-origin in dev so the
// Secure + SameSite=Strict session cookie behaves exactly as it does behind the hub.
const HUB_ORIGIN = process.env.HUB_ORIGIN || 'http://localhost:8080';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Supersede the old hand-rolled /sw.js at the SAME scope; take over open clients.
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The SW must NEVER turn an auth/API failure into a cached HTML shell.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/auth/,
          /^\/logout/,
          /^\/api/,
          /^\/pty/,
          /^\/healthz/,
        ],
      },
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'cloud-claude',
        short_name: 'cloud-claude',
        description: 'My personal OS — daily loop + reach my machines, over Tailscale.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/auth': { target: HUB_ORIGIN, changeOrigin: true },
      '/logout': { target: HUB_ORIGIN, changeOrigin: true },
      '/healthz': { target: HUB_ORIGIN, changeOrigin: true },
      '/api': { target: HUB_ORIGIN, changeOrigin: true },
      '/pty': { target: HUB_ORIGIN, changeOrigin: true, ws: true },
    },
  },
});
