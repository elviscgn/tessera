import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const [artifactArgument, tagArgument, commitArgument] = process.argv.slice(2);

if (!artifactArgument || !tagArgument || !commitArgument) {
  throw new Error('usage: node scripts/create-release-manifest.mjs <artifact> <tag> <commit>');
}

const artifactPath = resolve(artifactArgument);
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const artifactManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'examples/external-consumer/artifact-manifest.json'), 'utf8'),
);
const protocolSource = readFileSync(join(repositoryRoot, 'src/worker/bridge-protocol.ts'), 'utf8');
const protocolVersion = Number(protocolSource.match(/PROTOCOL_VERSION\s*=\s*(\d+)/u)?.[1]);
const artifactName = basename(artifactPath);
const expectedName = `tessera-runtime-${packageJson.version}.tgz`;

if (artifactName !== expectedName) {
  throw new Error(`unexpected artifact ${artifactName}; expected ${expectedName}`);
}
if (tagArgument !== `v${packageJson.version}`) {
  throw new Error(`tag ${tagArgument} does not match package version ${packageJson.version}`);
}
if (!Number.isInteger(protocolVersion)) {
  throw new Error('protocol version is missing from bridge-protocol.ts');
}

const checksum = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
if (checksum !== artifactManifest.sha256 || artifactManifest.filename !== artifactName) {
  throw new Error('packed artifact does not match the committed artifact manifest');
}

writeFileSync(`${artifactPath}.sha256`, `${checksum}  ${artifactName}\n`);
writeFileSync(
  join(dirname(artifactPath), 'release-manifest.json'),
  `${JSON.stringify(
    {
      tag: tagArgument,
      version: packageJson.version,
      commit: commitArgument,
      protocolVersion,
      artifact: artifactName,
      sha256: checksum,
    },
    null,
    2,
  )}\n`,
);

console.log(`Release manifest created for ${tagArgument}: ${artifactName} ${checksum}`);
