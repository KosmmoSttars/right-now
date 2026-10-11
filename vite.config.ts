/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build runs at kosmo-stars.ru/now/ and at any local path.
// In development the PHP data API is proxied to the live site.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': { target: 'https://kosmo-stars.ru/now', changeOrigin: true, secure: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'https://kosmo-stars.ru/now', changeOrigin: true, secure: true },
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
