import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(repositoryRoot, 'examples/external-consumer/artifact-manifest.json');

const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const frameworkVersion = packageJson.version;
const expectedArchive = `tessera-runtime-${frameworkVersion}.tgz`;

const packDirectory = mkdtempSync(join(tmpdir(), 'tessera-manifest-update-'));
let archiveName;
let checksum;
try {
  execFileSync('node', ['scripts/pack-runtime.mjs', packDirectory], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  const archives = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`expected one packed artifact, found ${archives.length}`);
  }
  archiveName = archives[0];
  checksum = createHash('sha256')
    .update(readFileSync(join(packDirectory, archiveName)))
    .digest('hex');
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}

if (archiveName !== expectedArchive) {
  throw new Error(`packed artifact ${archiveName} does not match expected ${expectedArchive}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = frameworkVersion;
manifest.filename = archiveName;
manifest.sha256 = checksum;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Updated artifact-manifest.json: ${archiveName} ${checksum}`);
