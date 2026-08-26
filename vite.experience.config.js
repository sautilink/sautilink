import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'preview-src/experience',
  base: '/preview/experience/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../../preview/experience',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
