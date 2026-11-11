// The demo builds to one self-contained page: its script, the card model, the artwork and the four stills are all
// inside index.html. It can be opened from a disk, published as a single file, and asks the network for nothing.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],          // so the model can be imported with ?inline, like the pictures
  plugins: [viteSingleFile()],
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
