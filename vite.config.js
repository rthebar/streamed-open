import { defineConfig } from 'vite';
import cricketProxyPlugin from './cricket-proxy-plugin.mjs';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
    open: true,
  },
  plugins: [cricketProxyPlugin()],
});
