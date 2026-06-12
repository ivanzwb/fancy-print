import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // 生产部署到 kiosk 静态目录
    assetsDir: 'assets',
  },
  server: {
    port: 3000,
    // 开发时 proxy gRPC-web 到 edge-daemon
    proxy: {
      '/api': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
    },
  },
});
