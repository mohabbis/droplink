import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const SIGNAL_PORT = Number(process.env.SIGNAL_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/ws': { target: `ws://localhost:${SIGNAL_PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
