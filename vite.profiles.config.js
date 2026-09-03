import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/profiles',
  base: '/preview/profiles/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/profiles',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
