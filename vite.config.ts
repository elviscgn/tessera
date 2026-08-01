import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const repositoryRoot = resolve(import.meta.dirname);
const scenarioLabRoot = resolve(repositoryRoot, 'apps/scenario-lab');

export default defineConfig({
  root: scenarioLabRoot,
  publicDir: false,
  server: {
    fs: {
      allow: [repositoryRoot],
    },
  },
  build: {
    emptyOutDir: true,
    outDir: resolve(repositoryRoot, 'dist/scenario-lab'),
    sourcemap: true,
  },
});
