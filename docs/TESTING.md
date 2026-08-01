# Testing

Milestone 0 tests prove reproducible project foundations:

- Prettier and rustfmt check formatting.
- ESLint and strict TypeScript check source boundaries.
- Cargo Clippy and native Cargo tests check all four crates.
- A direct `wasm32-unknown-unknown` build checks the Wasm target without generating bindings.
- Vitest checks committed tool and repository metadata.
- Vite production build smoke checks the Scenario Lab shell and dedicated Worker bundle.

Milestone 1 adds native deterministic-kernel coverage in `tessera-core`:

- Generational IDs reject stale handles and reuse slots with incremented generations.
- Fixed ticks schedule commands for the next unstarted tick and apply the declared ordering.
- Zero, duplicate, and non-monotonic sequences are consumed and rejected without entity mutation.
- ChaCha8 reference vectors and same-seed random commands are stable.
- Canonical BLAKE3 hashes are unchanged by event-log draining and differ when meaningful state changes.
- Replay records reproduce hashes across idle ticks and reject descending assigned ticks.

Run the focused native checkpoint with:

```text
cargo test --manifest-path rust/Cargo.toml -p tessera-core --all-targets
cargo clippy --manifest-path rust/Cargo.toml -p tessera-core --all-targets -- -D warnings
```

Run the aggregate `pnpm check` from the repository root after the pinned dependencies are installed. It expands to `pnpm check:format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:rust`, `pnpm check:wasm`, and `pnpm build`. Keep generated output ignored and inspect the staged file list before committing. Milestone 0 does not install Playwright, launch browsers, compare visuals, test gameplay, or add a test bridge.

Later milestones add native/Wasm parity, protocol fixtures, Worker boundary tests, Playwright flows, Chromium visuals, Firefox/WebKit smoke coverage, performance harnesses, lifecycle checks, and an isolated external consumer. Those checks are intentionally outside this native checkpoint.
