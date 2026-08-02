import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

const fail = (message) => {
  throw new Error(`release check failed: ${message}`);
};

const readJson = (relativePath) => {
  const path = resolve(repositoryRoot, relativePath);
  if (!existsSync(path)) {
    fail(`missing file ${relativePath}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`invalid JSON in ${relativePath}: ${String(error)}`);
  }
};

const readSource = (relativePath) => {
  const path = resolve(repositoryRoot, relativePath);
  if (!existsSync(path)) {
    fail(`missing file ${relativePath}`);
  }
  return readFileSync(path, 'utf8');
};

const packageJson = readJson('package.json');
const artifactManifest = readJson('examples/external-consumer/artifact-manifest.json');
const consumerPackage = readJson('examples/external-consumer/package.json');
const bridgeProtocol = readSource('src/worker/bridge-protocol.ts');
const dataProtocol = readSource('src/worker/data-protocol.ts');
const rustProtocol = readSource('rust/crates/tessera-protocol/src/lib.rs');

const frameworkVersion = packageJson.version;
if (typeof frameworkVersion !== 'string' || frameworkVersion.length === 0) {
  fail('package.json version must be a non-empty string');
}
if (artifactManifest.version !== frameworkVersion) {
  fail(
    `artifact manifest version ${artifactManifest.version} does not match package version ${frameworkVersion}`,
  );
}
if (consumerPackage.version !== frameworkVersion) {
  fail(
    `external consumer version ${consumerPackage.version} does not match package version ${frameworkVersion}`,
  );
}
const expectedArchive = `tessera-runtime-${frameworkVersion}.tgz`;
if (artifactManifest.filename !== expectedArchive) {
  fail(
    `artifact manifest filename ${artifactManifest.filename} does not match expected ${expectedArchive}`,
  );
}
if (artifactManifest.sha256 === 'TO_BE_FILLED_BY_CHECK_EXTERNAL_CONSUMER') {
  fail('artifact manifest checksum is not pinned');
}
const frameworkVersionPattern = new RegExp(
  String.raw`SAVE_FRAMEWORK_VERSION\s*=\s*['"]${frameworkVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
);
if (!frameworkVersionPattern.test(bridgeProtocol)) {
  fail(
    `bridge-protocol.ts SAVE_FRAMEWORK_VERSION does not match package version ${frameworkVersion}`,
  );
}

const protocolVersionPattern = /(?:export )?const PROTOCOL_VERSION\s*=\s*(\d+)/;
const rustMatch = rustProtocol.match(/pub const PROTOCOL_VERSION: u16 = (\d+);/);
const bridgeMatch = bridgeProtocol.match(protocolVersionPattern);
const dataMatch = dataProtocol.match(protocolVersionPattern);
if (!rustMatch || !bridgeMatch || !dataMatch) {
  fail('protocol version constant is missing from Rust or TypeScript');
}
const versions = new Set([rustMatch[1], bridgeMatch[1], dataMatch[1]]);
if (versions.size !== 1) {
  fail(
    `protocol version drift: Rust ${rustMatch[1]}, bridge ${bridgeMatch[1]}, data ${dataMatch[1]}`,
  );
}

const requiredDocs = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/CODING_RULES.md',
  'docs/CONTRIBUTING.md',
  'docs/DECISIONS.md',
  'docs/OBSERVABILITY.md',
  'docs/PERFORMANCE.md',
  'docs/PROTOCOL.md',
  'docs/ROADMAP.md',
  'docs/SETUP.md',
  'docs/TESTING.md',
];
for (const doc of requiredDocs) {
  if (!existsSync(resolve(repositoryRoot, doc))) {
    fail(`required documentation ${doc} is missing`);
  }
}

const roadmap = readSource('docs/ROADMAP.md');
if (!roadmap.includes('Milestone 14') || !roadmap.includes('Milestone 15')) {
  fail('docs/ROADMAP.md must record milestones 14 and 15');
}

const readme = readSource('README.md');
if (!/does not include|deliberately does not include/u.test(readme)) {
  fail('README.md must document known limitations');
}

const packDirectory = mkdtempSync(join(tmpdir(), 'tessera-release-check-'));
try {
  execFileSync('node', ['scripts/pack-runtime.mjs', packDirectory], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  const archives = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    fail(`expected one packed artifact, found ${archives.length}`);
  }
  const archive = archives[0];
  if (archive !== artifactManifest.filename) {
    fail(
      `packed artifact ${archive} does not match manifest filename ${artifactManifest.filename}`,
    );
  }
  const checksum = createHash('sha256')
    .update(readFileSync(join(packDirectory, archive)))
    .digest('hex');
  if (checksum !== artifactManifest.sha256) {
    fail(
      `artifact checksum mismatch (manifest ${artifactManifest.sha256}, packed ${checksum}); run pnpm pack:runtime and update artifact-manifest.json`,
    );
  }
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}

console.log(
  `Release validation passed: framework ${frameworkVersion}, protocol v${[...versions][0]}, ${requiredDocs.length} documents, artifact pinned.`,
);
