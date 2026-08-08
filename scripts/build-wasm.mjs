import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const versionFile = resolve(repositoryRoot, '.wasm-bindgen-version');
const expectedVersion = readFileSync(versionFile, 'utf8').trim();
const localWasmBindgen = resolve(
  repositoryRoot,
  `.tools/wasm-bindgen-${expectedVersion}/bin/wasm-bindgen`,
);
const wasmBindgenCommand = existsSync(localWasmBindgen) ? localWasmBindgen : 'wasm-bindgen';
const versionOutput = execFileSync(wasmBindgenCommand, ['--version'], {
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
// The pinned crates.io wasm-bindgen CLI's version is embedded in the artifact,
// so the build must drive that binary directly for byte reproducibility.
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
  wasmBindgenCommand,
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

// The `name` and `producers` custom sections embed rustc crate disambiguator
// hashes derived from the checkout path and the wasm-bindgen CLI build, so
// they are not reproducible across machines. They carry no runtime data.
const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const generatedWasm = resolve(outputDirectory, 'tessera_wasm_bg.wasm');
const wasmBytes = readFileSync(generatedWasm);
const strippedWasm = stripCustomSections(wasmBytes, new Set(['name', 'producers']));
if (strippedWasm.length !== wasmBytes.length) {
  writeFileSync(generatedWasm, strippedWasm);
}

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

// String-returning bindings repeat the same deferred-free pattern three
// times in the generated glue. Collapsing them into one helper keeps the
// checked-in module's structure a single copy of each block.
const stringResultBlock =
  /        let deferred1_0;\n        let deferred1_1;\n        try \{\n            const ret = wasm\.([a-z0-9_]+)\(this\.__wbg_ptr\);\n            deferred1_0 = ret\[0\];\n            deferred1_1 = ret\[1\];\n            return getStringFromWasm0\(ret\[0\], ret\[1\]\);\n        \} finally \{\n            wasm\.__wbindgen_free\(deferred1_0, deferred1_1, 1\);\n        \}/g;
const stringResultHelper = `function readStringResult(ptr, methodName) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm[methodName](ptr);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

`;
const normalizedSource = generatedSource
  .replaceAll(repeatedByteResult, '        return readU8Result(ret);')
  .replaceAll(repeatedByteResultV2, '        return readU8Result(ret);')
  .replaceAll(stringResultBlock, "        return readStringResult(this.__wbg_ptr, '$1');")
  .replace(
    'function __wbg_get_imports()',
    `${byteResultHelper}${stringResultHelper}function __wbg_get_imports()`,
  );
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

function stripCustomSections(wasm, namesToDrop) {
  const bytes = Buffer.from(wasm);
  const headerLength = WASM_HEADER.length;
  const kept = [bytes.subarray(0, headerLength)];
  let offset = headerLength;
  while (offset < bytes.length) {
    const sectionStart = offset;
    const sectionId = bytes[offset++];
    const lengthEnd = skipVarint(bytes, offset);
    const sectionEnd = lengthEnd + readSectionSize(bytes, offset, lengthEnd);
    const isCustom = sectionId === 0 && namesToDrop.has(customSectionName(bytes, lengthEnd));
    if (!isCustom) {
      kept.push(bytes.subarray(sectionStart, sectionEnd));
    }
    offset = sectionEnd;
  }
  return Buffer.concat(kept);
}

function readSectionSize(bytes, offset, end) {
  let size = 0;
  let shift = 0;
  while (offset < end) {
    size += (bytes[offset] & 0x7f) << shift;
    offset++;
    shift += 7;
  }
  return size;
}

function skipVarint(bytes, offset) {
  while (bytes[offset] & 0x80) offset++;
  return offset + 1;
}

function customSectionName(bytes, offset) {
  const nameLength = bytes[offset];
  return bytes.subarray(offset + 1, offset + 1 + nameLength).toString('utf8');
}
