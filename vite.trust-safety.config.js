import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/trust-safety',
  base: '/preview/trust-safety/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/trust-safety',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
