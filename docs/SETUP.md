# Local setup

The repository is pinned so a native run, a Wasm run, and CI use the same toolchain. Use Node 24.18.1 and pnpm 11.19.0 for JavaScript work. Rust 1.97.1 and the `wasm32-unknown-unknown` target are required for the simulation and Worker build.

## JavaScript tools

Use a version manager that reads `.node-version`, or select the version manually:

```sh
node --version       # 24.18.1
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm --version       # 11.19.0
pnpm install --frozen-lockfile
```

## Rust and Wasm

Install the pinned toolchain with the components used by the repository checks:

```sh
rustup toolchain install 1.97.1 \
  --profile minimal \
  --component rustfmt \
  --component clippy \
  --target wasm32-unknown-unknown

rustup default 1.97.1
rustc --version
rustup target list --installed
```

Install the pinned `wasm-pack` in the repository-local tools directory. Fallow 3.10.0 is installed by the frozen JavaScript dependency install; it does not need a separate global installation.

```sh
cargo install wasm-pack --version 0.15.0 --locked --root .tools/wasm-pack-0.15.0
.tools/wasm-pack-0.15.0/bin/wasm-pack --version
```

## Run the project

From the repository root:

```sh
pnpm tool:versions
pnpm check
pnpm dev
```

Open the Scenario Lab at the local URL printed by Vite. The development page runs the Rust/Wasm probe, shows the Babylon foundation scene, and exposes its current diagnostics in the page markup for browser checks.

During development the page also registers `window.tesseraTest`. It is a
read-only inspection and command facade for explicit tick waits, snapshot
inspection, camera and selection queries, annotated captures, and reproduction
manifests. Production builds omit the registration; consumers that need the
same surface can import `@tessera/runtime/testkit` from a development entry.

## What `pnpm check` does

The repository gate runs, in order:

- Prettier and rustfmt;
- ESLint and strict TypeScript checks;
- Vitest;
- Rust Clippy and the complete Rust test suite;
- the pinned `wasm-pack --target web` build;
- the Vite production build.

The generated Worker module under `src/worker/wasm` is checked in because it is an application input. Rebuild it with `pnpm check:wasm`; if the output changes, inspect the diff before committing.

Keep `pnpm-lock.yaml` and `rust/Cargo.lock` committed. Clean environments should use `pnpm install --frozen-lockfile` so dependency resolution does not drift.
