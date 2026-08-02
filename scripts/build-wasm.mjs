import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
