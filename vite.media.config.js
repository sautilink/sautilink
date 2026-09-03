import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/media',
  base: '/preview/media/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/media',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
