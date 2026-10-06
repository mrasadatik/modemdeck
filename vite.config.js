import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  root: 'frontend',
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/events': 'http://127.0.0.1:3000' } },
});
