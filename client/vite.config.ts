import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [react()],
  // Served at /collab/ when co-deployed inside EngineX
  base: isProd ? '/collab/' : '/',
  resolve: {
    alias: {
      // Allow client to import from the shared workspace package
      // without compiling it first — Vite handles TypeScript directly.
      '@crdt/shared': path.resolve(__dirname, '../shared/src'),
    },
  },  server: {
    port: 5173,
  },
});
