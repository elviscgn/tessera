import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const versionFile = resolve(repositoryRoot, '.wasm-bindgen-version');
const expectedVersion = readFileSync(versionFile, 'utf8').trim();
const versionOutput = execFileSync('wasm-bindgen', ['--version'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
const actualVersion = /^wasm-bindgen\s+(\S+)/u.exec(versionOutput)?.[1];

if (actualVersion !== expectedVersion) {
  throw new Error(
    `wasm-bindgen ${expectedVersion} is required; found ${actualVersion ?? versionOutput.trim()}`,
  );
}

const outputDirectory = resolve(repositoryRoot, 'src/worker/wasm');
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
const toolchainDirectory = readdirSync(join(rustupHome, 'toolchains')).find((entry) =>
  entry.startsWith('1.97.1-'),
);
if (!toolchainDirectory) {
  throw new Error('could not locate the 1.97.1 toolchain under RUSTUP_HOME/toolchains');
}
const remapPrefixes = [
  // The installed toolchain directory embeds the host triple
  // (aarch64-apple-darwin locally, x86_64-unknown-linux-gnu in CI).
  join(rustupHome, 'toolchains', toolchainDirectory),
  join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'registry'),
  repositoryRoot,
];
// wasm-pack installs a platform-specific wasm-bindgen CLI build whose own
// version string is embedded in the artifact, so the pack must drive the
// pinned crates.io wasm-bindgen binary directly for byte reproducibility.
const rustFlags = [
  process.env.RUSTFLAGS,
  ...remapPrefixes.map((prefix, index) => `--remap-path-prefix=${prefix}=build-path-${index}`),
]
  .filter(Boolean)
  .join(' ');
execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '--manifest-path',
    'rust/crates/tessera-wasm/Cargo.toml',
  ],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Panic locations and debug strings embed absolute source paths.
      // Remapping them makes the wasm byte-identical across machines.
      RUSTFLAGS: rustFlags,
    },
  },
);
execFileSync(
  'wasm-bindgen',
  [
    '--target',
    'web',
    '--out-dir',
    outputDirectory,
    '--out-name',
    'tessera_wasm',
    'rust/target/wasm32-unknown-unknown/release/tessera_wasm.wasm',
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

// The Worker imports the web-target initializer by name. Keeping the adapter
// named avoids carrying an otherwise unused default export through the
// application's module graph while preserving the generated implementation.
const generatedModule = resolve(outputDirectory, 'tessera_wasm.js');
const generatedSource = readFileSync(generatedModule, 'utf8');
const repeatedByteResult = `        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;`;
const repeatedByteResultV2 = repeatedByteResult
  .replace('var v1', 'var v2')
  .replace('return v1', 'return v2');
const byteResultHelper = `function readU8Result(ret) {
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    const value = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return value;
}

`;
const normalizedSource = generatedSource
  .replaceAll(repeatedByteResult, '        return readU8Result(ret);')
  .replaceAll(repeatedByteResultV2, '        return readU8Result(ret);')
  .replace('function __wbg_get_imports()', `${byteResultHelper}function __wbg_get_imports()`);
writeFileSync(
  generatedModule,
  normalizedSource.replace(
    'export { initSync, __wbg_init as default };',
    'export { initSync, __wbg_init as init };',
  ),
);
const generatedTypes = resolve(outputDirectory, 'tessera_wasm.d.ts');
const generatedTypeSource = readFileSync(generatedTypes, 'utf8');
writeFileSync(
  generatedTypes,
  generatedTypeSource.replace('export default function __wbg_init (', 'export function init ('),
);
