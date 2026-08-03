import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzip } from 'pako';
import { join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const frameworkVersion = packageJson.version;
const archiveName = `tessera-runtime-${frameworkVersion}.tgz`;
const outputDir = resolve(process.argv[2] ?? join(repositoryRoot, 'artifacts'));
const outputPath = join(outputDir, archiveName);

const FAIL = (message) => {
  throw new Error(`pack runtime failed: ${message}`);
};

const fixedMtime = 499162500;

const entryPaths = [];
const collect = (path) => {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    entryPaths.push(path);
    return;
  }
  for (const entry of readdirSync(path).sort()) {
    collect(join(path, entry));
  }
};

for (const file of packageJson.files) {
  const path = resolve(repositoryRoot, file);
  if (!existsSync(path)) {
    FAIL(`package.json "files" entry missing: ${file}`);
  }
  collect(path);
}
collect(join(repositoryRoot, 'package.json'));
entryPaths.sort();

const tarName = (path) => `package/${relative(repositoryRoot, path)}`;
const header = Buffer.alloc(512);
const zeroBlock = Buffer.alloc(512);

const writeHeader = (name, size) => {
  header.fill(0);
  const nameBuffer = Buffer.from(name, 'utf8');
  if (nameBuffer.length > 100) {
    FAIL(`tar entry name too long: ${name}`);
  }
  nameBuffer.copy(header, 0);
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write(fixedMtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.from(header);
};

execFileSync('pnpm', ['build:package'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

const tarBuffers = [];
for (const path of entryPaths) {
  const data = readFileSync(path);
  tarBuffers.push(writeHeader(tarName(path), data.length));
  tarBuffers.push(data);
  const padding = (512 - (data.length % 512)) % 512;
  if (padding > 0) {
    tarBuffers.push(Buffer.alloc(padding));
  }
}
tarBuffers.push(zeroBlock, zeroBlock);
const tar = Buffer.concat(tarBuffers);
const compressed = gzip(tar, { mtime: 0, level: 9 });
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, Buffer.from(compressed));
console.log(`packed ${archiveName} to ${outputPath}`);
