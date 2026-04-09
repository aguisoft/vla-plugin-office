import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pluginJson = JSON.parse(
  readFileSync(resolve(__dirname, '../plugin.json'), 'utf-8')
);
const pluginName: string = pluginJson.name;

export default defineConfig({
  plugins: [react()],
  base: `/api/v1/p/${pluginName}/ui/`,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
