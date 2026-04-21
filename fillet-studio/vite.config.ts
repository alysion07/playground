import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5175 },
  // Vitest uses this config; keep tests in node env (core modules are pure TS).
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
