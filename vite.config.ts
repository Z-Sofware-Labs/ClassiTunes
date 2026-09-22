import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Always ignore src-tauri folder and Rust build outputs to prevent EBUSY lock issues.
      watch: process.env.DISABLE_HMR === 'true'
        ? { ignored: ['**/*'] }
        : { ignored: ['**/src-tauri/**'] },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        onwarn(warning, warn) {
          // Suppress benign eval warning in third-party file-type/music-metadata-browser library
          if (warning.code === 'EVAL' && warning.id?.includes('file-type')) {
            return;
          }
          warn(warning);
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@wasm-audio-decoders') || id.includes('codec-parser')) {
                // OGG WASM decoder — lazily loaded only when playing OGG on unsupported platforms
                return 'vendor-ogg-decoder';
              }
              if (
                id.includes('music-metadata-browser') ||
                id.includes('file-type') ||
                id.includes('strtok3') ||
                id.includes('token-types') ||
                id.includes('peek-readable')
              ) {
                return 'vendor-metadata';
              }
              if (id.includes('@tauri-apps')) {
                return 'vendor-tauri';
              }
              return 'vendor';
            }
          },
        },
      },
    },
  };
});