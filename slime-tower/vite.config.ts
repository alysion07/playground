import { defineConfig } from 'vite';

// Sub-path deployment: gallery at "/", this toy at "/slime/".
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  assetsInclude: ['**/*.wgsl', '**/*.glsl'],
  server: {
    port: 5174,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
