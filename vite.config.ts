import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The application shell (CLAUDE.md's stack line). Everything under src/ui
// is the only thing this bundles — src/contracts, src/engine and src/db are
// plain TypeScript consumed by it, not bundled separately.
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
  },
});
