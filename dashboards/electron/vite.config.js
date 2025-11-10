// dashboards/electron/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // With root set to renderer/, paths are resolved relative to it.
        // Use .. to reference files outside the renderer root.
        entry: '../main/main.js',
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: '../preload/preload.js',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  root: resolve(__dirname, 'renderer'),
  base: './', // Use relative paths for Electron
  build: {
    outDir: resolve(__dirname, 'dist'),
  },
  server: {
    port: 5173,
  },
});
