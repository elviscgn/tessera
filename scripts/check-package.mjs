import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packDirectory = mkdtempSync(join(tmpdir(), 'tessera-package-check-'));

const fail = (message) => {
  throw new Error(`package check failed: ${message}`);
};

try {
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  const archives = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    fail(`expected one tarball, found ${archives.length}`);
  }
  const archive = join(packDirectory, archives[0]);
  const entries = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const packageJsonEntry = 'package/package.json';
  if (!entries.includes(packageJsonEntry)) {
    fail('tarball does not contain package/package.json');
  }
  const packageJson = JSON.parse(
    execFileSync('tar', ['-xOf', archive, packageJsonEntry], { encoding: 'utf8' }),
  );
  if (packageJson.name !== '@tessera/runtime') {
    fail(`unexpected package name ${packageJson.name}`);
  }
  const exportKeys = Object.keys(packageJson.exports ?? {}).sort();
  if (exportKeys.join(',') !== '.,./testkit') {
    fail(`unexpected export map ${exportKeys.join(',')}`);
  }

  const forbidden = entries.filter((entry) =>
    /package\/(?:src|tests|PLAN|AGENTS|CURRENT_TASK|\.agent|\.local-notes)(?:\/|$)/u.test(entry),
  );
  if (forbidden.length > 0) {
    fail(`internal paths leaked into the tarball: ${forbidden.join(', ')}`);
  }

  for (const required of [
    'package/dist/package/index.js',
    'package/dist/package/index.js.map',
    'package/dist/package/testkit.js',
    'package/dist/package/public/index.d.ts',
    'package/dist/package/public/testkit.d.ts',
  ]) {
    if (!entries.includes(required)) {
      fail(`missing required package entry ${required}`);
    }
  }
  if (
    !entries.some((entry) =>
      /^package\/dist\/package\/assets\/foundation\.worker-[^/]+\.js$/u.test(entry),
    )
  ) {
    fail('missing bundled Worker entry');
  }

  console.log(`Package export/content check passed (${archives[0]}).`);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
