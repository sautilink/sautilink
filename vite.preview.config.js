import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/app-shell',
  base: '/preview/app-shell/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/app-shell',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
