import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // three.js alone is ~550 kB minified and now lives in its own lazily-loaded
    // chunk (the 3D world), so don't warn about it.
    chunkSizeWarningLimit: 600,
  },
});
