/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // A production bundle without an API origin would call /api on the static host and get the
  // SPA's index.html back with a 200. Refuse to build it rather than ship that.
  if (command === 'build' && mode === 'production' && !env.VITE_API_URL) {
    throw new Error('VITE_API_URL is not set. Set it to the API origin, e.g. https://dockiq-api.koyeb.app');
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      // Deliberate: lets tunnelled demo URLs reach the dev server. Dev only — never a hosted build.
      allowedHosts: true,
      proxy: {
        '/api': 'http://localhost:8000',
        '/ws': { target: 'ws://localhost:8000', ws: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
            if (id.includes('node_modules')) return 'vendor';
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
