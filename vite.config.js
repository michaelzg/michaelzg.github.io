import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/assets/demos/tiny-forest-shrine/',
  build: {
    // Preserve the separately encoded posters and videos beside the UI bundle.
    emptyOutDir: false,
    outDir: resolve(import.meta.dirname, 'assets/demos/tiny-forest-shrine'),
    rollupOptions: {
      input: resolve(import.meta.dirname, '_demos/tiny-forest-shrine/main.jsx'),
      output: {
        entryFileNames: 'tiny-forest-immersive-landing.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'tiny-forest-immersive-landing.css';
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
