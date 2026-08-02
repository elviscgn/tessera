# Testing

Milestones 0 and 1 tests prove reproducible foundations and native authority:

- Prettier and rustfmt check formatting.
- ESLint and strict TypeScript check source boundaries.
- Cargo Clippy and native Cargo tests check all four crates.
- The pinned `wasm-pack --target web` build regenerates the checked-in Worker module and Wasm asset.
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

Milestone 2A adds the coarse authority-boundary checks:

- Rust protocol tests round-trip little-endian command TLVs, reject malformed totals, reject required flags and unknown opcodes, and verify the fixed response layout.
- The native Wasm adapter test submits the same spawn batch used by the browser probe, advances one tick, and checks the canonical response hash. The adapter also tests the five-tick per-call bound.
- Vitest checks the TypeScript command encoder, fixed response decoder, and structured Wasm error parser.
- The generated web-target module is loaded by the dedicated Worker in the Scenario Lab probe. A successful browser-visible probe reaches tick 1 with state hash `24ebdfb8bf10251c184a2bcd57d48a6b7d77be51114fbcf75847f77f32adb104`.

Run the focused 2A checks with:

```text
pnpm test
cargo test --manifest-path rust/Cargo.toml --workspace --all-targets
pnpm check:wasm
pnpm build
```

The browser probe is a development-only smoke check for this checkpoint; it does not install Playwright or assert renderer behavior. Milestone 2B must add packed data fixtures, Wasm-memory growth recovery, transferable-buffer ownership and backpressure tests, and native-versus-Wasm fixture parity before renderer work starts.

Run the aggregate `pnpm check` from the repository root after the pinned dependencies are installed. It expands to `pnpm check:format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:rust`, `pnpm check:wasm`, and `pnpm build`. The generated Wasm module is a checked-in application input; inspect its regenerated diff and the staged file list before committing. Milestones 0–2A do not install Playwright, compare visuals, test gameplay, or add a test bridge.

Later milestones add native/Wasm parity, protocol fixtures, Worker boundary tests, Playwright flows, Chromium visuals, Firefox/WebKit smoke coverage, performance harnesses, lifecycle checks, and an isolated external consumer. Those checks are intentionally outside this native checkpoint.
