import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The workbench is built straight into the directory the Node host serves
 * (`dist/app/public/workbench`, see src/app/server.ts). Building anywhere else
 * makes "build" and "serve" two different artifacts: the old configuration wrote
 * into src/app/public/workbench, so a single build served the previous bundle and
 * `pnpm ui:build` alone never updated what the server returned.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/workbench/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../../dist/app/public/workbench', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
