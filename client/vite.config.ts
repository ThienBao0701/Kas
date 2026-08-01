/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The backend runs on :3001 in development; the client dev server proxies
// /api to it so the browser stays same-origin and the session cookie flows.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // We register + surface updates ourselves via useRegisterSW (PwaManager).
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Kas Booking Dispatch',
        short_name: 'Kas',
        description: 'Trung tâm điều phối đặt phòng Booking.com nội bộ.',
        lang: 'vi',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built static frontend only.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA navigation falls back to the app shell, but NEVER for /api — so an
        // authenticated API request can never be answered from the cache.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        // No runtime caching at all: operational/API data is always fetched live.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // Bind to all interfaces so receptionist machines on the LAN can reach the
    // dev server; production is served same-origin by the backend.
    host: true,
    // Reachable through the operator's tunnel hostname as well as the LAN.
    allowedHosts: ['kasbookingapp.com'],
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
