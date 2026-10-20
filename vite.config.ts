/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build runs at kosmo-stars.ru/now/ and at any local path.
// In development the PHP data API is proxied to the live site; `npm run dev:local`
// sends the spacecraft endpoints to a local `php -S 127.0.0.1:3132 -t public`
// instead, to try data.php changes before they are deployed.
const live = { target: 'https://kosmo-stars.ru/now', changeOrigin: true, secure: true };
const localCraft = { '^/api/data\\.php\\?set=craft': { target: 'http://127.0.0.1:3132' } };

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    proxy: { ...(mode === 'localapi' ? localCraft : {}), '/api': live },
  },
  preview: {
    proxy: { '/api': live },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
