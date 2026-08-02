import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(repositoryRoot, relativePath), 'utf8');

describe('Milestone 0 foundation metadata', () => {
  it('keeps exact tool pins and excludes future runtime dependencies', () => {
    const packageJson = readRepositoryFile('package.json');
    const rustToolchain = readRepositoryFile('rust-toolchain.toml');

    expect(packageJson).toContain('"private": true');
    expect(packageJson).toContain('"type": "module"');
    expect(packageJson).toContain('"packageManager": "pnpm@11.19.0"');
    expect(packageJson).toContain('"node": "24.18.1"');
    expect(packageJson).toContain('"pnpm": "11.19.0"');
    expect(packageJson).toContain('"typescript": "6.0.3"');
    expect(packageJson).toContain('"vite": "8.1.5"');
    expect(packageJson).toContain('"vitest": "4.1.10"');
    expect(packageJson).toContain('"eslint": "10.8.0"');
    expect(packageJson).toContain('"prettier": "3.9.6"');
    expect(packageJson).toContain('"@babylonjs/core": "9.19.0"');
    expect(packageJson).toContain('"@babylonjs/loaders": "9.19.0"');
    expect(packageJson).toContain('"@playwright/test": "1.60.0"');
    expect(packageJson).not.toMatch(/"(react|react-dom)"\s*:/);
    expect(readRepositoryFile('.node-version').trim()).toBe('24.18.1');
    expect(readRepositoryFile('.wasm-pack-version').trim()).toBe('0.15.0');
    expect(rustToolchain).toContain('channel = "1.97.1"');
    expect(rustToolchain).toContain('wasm32-unknown-unknown');
  });
});
