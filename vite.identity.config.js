import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/identity',
  base: '/preview/identity/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/identity',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
