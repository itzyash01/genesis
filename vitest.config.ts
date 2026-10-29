import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls: false } })],
  resolve: { dedupe: ['vue'], alias: { '@guolao/vue-monaco-editor': fileURLToPath(new URL('./tests/fixtures/monaco.ts', import.meta.url)), 'openai': fileURLToPath(new URL('./functions/node_modules/openai/index.mjs', import.meta.url)), '@lucide/vue': fileURLToPath(new URL('./tests/fixtures/icons.ts', import.meta.url)), '@': fileURLToPath(new URL('./frontend/src', import.meta.url)), 'firebase/app': fileURLToPath(new URL('./frontend/node_modules/firebase/app/dist/esm/index.esm.js', import.meta.url)), 'firebase/app-check': fileURLToPath(new URL('./frontend/node_modules/firebase/app-check/dist/esm/index.esm.js', import.meta.url)), 'firebase/auth': fileURLToPath(new URL('./frontend/node_modules/firebase/auth/dist/esm/index.esm.js', import.meta.url)), 'firebase/functions': fileURLToPath(new URL('./frontend/node_modules/firebase/functions/dist/esm/index.esm.js', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['functions/src/**/*.ts', 'frontend/src/**/*.{ts,vue}'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
