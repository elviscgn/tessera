# Testing

Milestone 0 tests prove reproducible project foundations only:

- Prettier and rustfmt check formatting.
- ESLint and strict TypeScript check source boundaries.
- Cargo Clippy and native Cargo tests check all four crates.
- A direct `wasm32-unknown-unknown` build checks the Wasm target without generating bindings.
- Vitest checks committed tool and repository metadata.
- Vite production build smoke checks the Scenario Lab shell and dedicated Worker bundle.

Run the aggregate `pnpm check` from the repository root after the foundation scripts exist. Keep generated output ignored and inspect the staged file list before committing. Milestone 0 does not install Playwright, launch browsers, compare visuals, test gameplay, or add a test bridge.

Later milestones add native/Wasm parity, protocol fixtures, Worker boundary tests, Playwright flows, Chromium visuals, Firefox/WebKit smoke coverage, performance harnesses, lifecycle checks, and an isolated external consumer. Those checks must not be backfilled into this foundation checkpoint.
