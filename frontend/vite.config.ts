import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://host.docker.internal:8000' } },
});
