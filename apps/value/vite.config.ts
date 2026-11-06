import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` inlines everything into one HTML file (handy for
// previews and hosting the page anywhere static files are served).
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /<repo-name>/; set by the deploy workflow.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  // Vitest swaps CSS for an empty string, ?raw included. footer.test.ts reads the shared footer's stylesheet and index.css as text.
  test: { css: { include: [/footer\.css/, /index\.css/] } },
}))
