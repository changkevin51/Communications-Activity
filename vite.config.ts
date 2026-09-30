import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'screen-route',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && /^\/screen\/[^/.]+\/?(\?.*)?$/.test(req.url)) req.url = '/screen.html';
          else if (req.url && /^\/host\/?(\?.*)?$/.test(req.url)) req.url = '/host.html';
          next();
        });
      },
    },
  ],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        host: resolve(import.meta.dirname, 'host.html'),
        screen: resolve(import.meta.dirname, 'screen.html'),
      },
    },
  },
  define: {
    __TEST_HOOKS__: JSON.stringify(process.env.VITE_TEST_HOOKS === '1'),
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
