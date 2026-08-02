import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageOutput = resolve(repositoryRoot, 'dist/package');
const workerFilePattern = /^assets\/foundation\.worker-[^/]+\.js$/u;
const workerUrlPattern =
  /new Worker\(new URL\(\s*(?:\/\*[\s\S]*?\*\/\s*)?"\/assets\/foundation\.worker-[^"]+\.js",\s*"" \+ import\.meta\.url\s*\),\s*\{\s*name: "tessera-runtime",\s*type: "module"\s*\}\)/u;

const findWorkerEntry = (bundle) =>
  Object.entries(bundle).find(
    ([fileName, output]) =>
      workerFilePattern.test(fileName) && (output.type === 'chunk' || output.type === 'asset'),
  );

const assertPackageEntries = (workerEntry, indexEntry, bundle) => {
  if (workerEntry === undefined || indexEntry?.type !== 'chunk') {
    throw new Error(
      `package build could not locate the generated Worker and runtime entry (${Object.keys(bundle).join(', ')})`,
    );
  }
};

const workerSourceFrom = (workerChunk) => {
  const source = workerChunk.type === 'chunk' ? workerChunk.code : workerChunk.source;
  return source.toString().replace(/\n\/\/# sourceMappingURL=.*$/u, '');
};

const rewriteWorkerUrl = (indexCode) => {
  if (!workerUrlPattern.test(indexCode)) {
    throw new Error('package build could not locate the generated Worker URL');
  }
  return indexCode.replace(
    workerUrlPattern,
    '(() => { const workerUrl = URL.createObjectURL(new Blob([tesseraWorkerSource], { type: "text/javascript" })); try { return new Worker(workerUrl, { name: "tessera-runtime", type: "module" }); } finally { URL.revokeObjectURL(workerUrl); } })()',
  );
};

const inlineWorkerSource = () => ({
  name: 'tessera-inline-worker-source',
  generateBundle(_options, bundle) {
    const workerEntry = findWorkerEntry(bundle);
    const indexEntry = bundle['index.js'];
    assertPackageEntries(workerEntry, indexEntry, bundle);
    const [, workerChunk] = workerEntry;
    const workerSource = workerSourceFrom(workerChunk);
    this.emitFile({
      type: 'asset',
      fileName: 'worker-source.js',
      source: `export const tesseraWorkerSource = ${JSON.stringify(workerSource)};\n`,
    });
    indexEntry.code = `import { tesseraWorkerSource } from './worker-source.js';\n${rewriteWorkerUrl(indexEntry.code)}`;
  },
});

await build({
  root: repositoryRoot,
  define: {
    // The testkit is an explicit development entry point. Its caller's build
    // decides whether to include it; the production application never imports
    // it, so the runtime entry remains free of the registration side effect.
    'import.meta.env.PROD': 'false',
  },
  plugins: [inlineWorkerSource()],
  build: {
    emptyOutDir: true,
    outDir: packageOutput,
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(repositoryRoot, 'src/public/index.ts'),
        testkit: resolve(repositoryRoot, 'src/public/testkit.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id.startsWith('@babylonjs/'),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
});

execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.package.json'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
