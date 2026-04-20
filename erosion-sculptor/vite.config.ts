import { defineConfig } from 'vite';

const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  assetsInclude: ['**/*.wgsl'],
  server: {
    port: 5174,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
