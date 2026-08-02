import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(repositoryRoot, 'artifacts/performance/native.json');
const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === '--') {
  forwardedArguments.shift();
}
const outputIndex = forwardedArguments.indexOf('--output');
const outputPath =
  outputIndex >= 0 && forwardedArguments[outputIndex + 1] !== undefined
    ? resolve(repositoryRoot, forwardedArguments[outputIndex + 1])
    : defaultOutput;

if (outputIndex < 0) {
  forwardedArguments.push('--output', outputPath);
}
mkdirSync(dirname(outputPath), { recursive: true });

const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
if (!existsSync(resolve(repositoryRoot, 'rust/Cargo.toml'))) {
  throw new Error('rust workspace is missing');
}
execFileSync(
  cargo,
  [
    'run',
    '--release',
    '--manifest-path',
    'rust/Cargo.toml',
    '-p',
    'tessera-cli',
    '--',
    'bench',
    ...forwardedArguments,
  ],
  {
    cwd: repositoryRoot,
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    stdio: 'inherit',
  },
);
