# Local setup

Milestone 2A uses exact tool versions. Select Node 24.18.1 with a version manager that reads `.node-version`; do not substitute the host Node version.

```sh
node --version
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm --version
pnpm install --frozen-lockfile
```

Install the pinned Rust toolchain and Wasm target:

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy --target wasm32-unknown-unknown
rustc --version
rustup target list --installed
cargo install wasm-pack --version 0.15.0 --locked --root .tools/wasm-pack-0.15.0
.tools/wasm-pack-0.15.0/bin/wasm-pack --version
```

Verify the JavaScript tools and run the foundation gate:

```sh
pnpm tool:versions
pnpm check
```

`pnpm check` runs formatting, ESLint, strict TypeScript, Vitest, native Rust checks, the pinned `wasm-pack --target web` build, and the Vite production build. It does not install Babylon, Playwright, React, or a renderer. The generated Worker module under `src/worker/wasm` is checked in because it is an application build input; `pnpm check:wasm` regenerates it and the diff must remain reproducible. Keep `pnpm-lock.yaml` and `rust/Cargo.lock` committed and use `pnpm install --frozen-lockfile` in clean environments.
