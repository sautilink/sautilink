import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/messages',
  base: '/preview/messages/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/messages',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
