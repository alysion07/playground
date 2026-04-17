import { defineConfig } from 'vite';

// Sub-path deployment: gallery at "/", this toy at "/metaball/".
// `BASE_PATH` env override lets the root build.mjs inject a different prefix
// (or "/" during local dev).
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
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
