import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/conversations',
  base: '/preview/conversations/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/conversations',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
