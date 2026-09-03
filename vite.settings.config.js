import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/settings',
  base: '/preview/settings/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/settings',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
