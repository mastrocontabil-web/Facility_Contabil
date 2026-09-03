import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // No dev, encaminha /api pro backend — evita CORS e simplifica o .env.
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
