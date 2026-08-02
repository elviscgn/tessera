import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(repositoryRoot, 'examples/external-consumer');
const checkRoot = mkdtempSync(join(tmpdir(), 'tessera-external-consumer-'));
const consumerRoot = join(checkRoot, 'consumer');
const artifactRoot = join(consumerRoot, 'artifacts');

const fail = (message) => {
  throw new Error(`external consumer check failed: ${message}`);
};

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: process.env.CI ?? '1' },
  });

try {
  cpSync(fixtureRoot, consumerRoot, { recursive: true });
  const manifestPath = join(consumerRoot, 'artifact-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.sha256 === 'TO_BE_FILLED_BY_CHECK_EXTERNAL_CONSUMER') {
    fail('artifact-manifest.json must contain the committed tarball checksum');
  }

  run('node', ['scripts/pack-runtime.mjs', artifactRoot], repositoryRoot);
  const archives = readdirSync(artifactRoot).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    fail(`expected one packed artifact, found ${archives.length}`);
  }
  const archiveName = archives[0];
  const archivePath = join(artifactRoot, archiveName);
  const checksum = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if (archiveName !== manifest.filename || checksum !== manifest.sha256) {
    fail(
      `artifact pin mismatch (expected ${manifest.filename} ${manifest.sha256}, got ${archiveName} ${checksum})`,
    );
  }

  run('pnpm', ['install', '--offline', '--no-frozen-lockfile'], consumerRoot);

  const sourceFiles = [
    join(consumerRoot, 'src/main.ts'),
    join(consumerRoot, 'tests/consumer.spec.ts'),
  ];
  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, 'utf8');
    if (/@tessera\/runtime\/(?!testkit\b)/u.test(source)) {
      fail(`internal runtime import found in ${sourceFile}`);
    }
  }

  run(
    'node',
    [
      '--input-type=module',
      '-e',
      "const runtime = await import.meta.resolve('@tessera/runtime'); const testkit = await import.meta.resolve('@tessera/runtime/testkit'); if (!runtime.endsWith('/dist/package/index.js') || !testkit.endsWith('/dist/package/testkit.js')) process.exit(1); try { await import.meta.resolve('@tessera/runtime/src/public/index.ts'); process.exit(1); } catch {}",
    ],
    consumerRoot,
  );
  run('pnpm', ['run', 'build'], consumerRoot);
  run('pnpm', ['run', 'test:e2e'], consumerRoot);

  console.log(`External consumer passed outside the workspace (${checkRoot}).`);
} finally {
  rmSync(checkRoot, { recursive: true, force: true });
}
