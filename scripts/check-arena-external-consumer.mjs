// CI check (M23): copies the outside-workspace consumer crate into a temp
// dir, points its dependency at the checkout's tessera-arena, and verifies
// the deterministic probe hash — proving the crate composes beyond the
// workspace without leaking internal paths.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixture = resolve(repositoryRoot, 'examples/arena-external-consumer');
const arenaCrate = resolve(repositoryRoot, 'rust/crates/tessera-arena');
const checkRoot = mkdtempSync(join(tmpdir(), 'tessera-arena-consumer-'));
const fail = (message) => {
  throw new Error(`arena external consumer check failed: ${message}`);
};
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

try {
  const consumerRoot = join(checkRoot, 'consumer');
  cpSync(fixture, consumerRoot, { recursive: true });

  const manifestPath = join(consumerRoot, 'Cargo.toml');
  const manifest = readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('@TESSERA_ARENA_PATH@')) {
    fail('fixture manifest must carry the @TESSERA_ARENA_PATH@ placeholder');
  }
  writeFileSync(manifestPath, manifest.replaceAll('@TESSERA_ARENA_PATH@', arenaCrate));

  const source = readFileSync(join(consumerRoot, 'src/main.rs'), 'utf8');
  if (!source.includes('tessera_arena::')) {
    fail('consumer must exercise the public API through the crate name');
  }

  run('cargo', ['test', '--offline', '--manifest-path', manifestPath], checkRoot);

  console.log(`Arena external consumer passed outside the workspace (${checkRoot}).`);
} finally {
  rmSync(checkRoot, { recursive: true, force: true });
}
