import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.wgsl', '**/*.glsl'],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
