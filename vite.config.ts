/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the built site works from any path (GitHub Pages project sites,
// Cloudflare Pages, or a local static server) without per-host configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'], charts: ['recharts'], react: ['react', 'react-dom'] },
      },
    },
  },
  test: { include: ['tests/web/**/*.test.ts'], environment: 'node' },
});
