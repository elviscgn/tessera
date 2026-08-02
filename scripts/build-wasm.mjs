import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const versionFile = resolve(repositoryRoot, '.wasm-pack-version');
const expectedVersion = readFileSync(versionFile, 'utf8').trim();
const versionOutput = execFileSync('wasm-pack', ['--version'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
const actualVersion = /^wasm-pack\s+(\S+)/u.exec(versionOutput)?.[1];

if (actualVersion !== expectedVersion) {
  throw new Error(
    `wasm-pack ${expectedVersion} is required; found ${actualVersion ?? versionOutput.trim()}`,
  );
}

const outputDirectory = resolve(repositoryRoot, 'src/worker/wasm');
execFileSync(
  'wasm-pack',
  [
    'build',
    'rust/crates/tessera-wasm',
    '--target',
    'web',
    '--release',
    '--out-dir',
    outputDirectory,
    '--no-pack',
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

// wasm-pack uses a package-publishing .gitignore in every output directory;
// this checked-in generated module is an application build input instead.
const generatedIgnore = resolve(outputDirectory, '.gitignore');
if (existsSync(generatedIgnore)) {
  rmSync(generatedIgnore);
}
