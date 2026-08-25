import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/share-stream',
  base: '/preview/share-stream/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/share-stream',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
