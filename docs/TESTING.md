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

Milestone 2B adds the data-plane and ownership checks:

- Rust protocol tests verify the fixed render header and region table, renderer-neutral SoA payloads, fixed event record sizes, all event variants, contiguous sequence metadata, and rejection of sequence gaps.
- TypeScript data-plane validation rejects malformed magic, versions, lengths, region capacities, table overlaps, interval overlaps, unsupported scalar types, event gaps, and trailing bytes before a renderer or acknowledgement sees them.
- The three-slot transferable pool tests power-of-two capacity reuse, in-flight ownership, safe exhaustion drops, and invalid returns. `MemoryViewTracker` tests confirm that a `WebAssembly.Memory.grow()` changes the buffer identity and increments the view generation exactly once.
- The generated web-target Wasm parity test compares the native probe hash, decodes the packed snapshot and event batch, acknowledges the event checkpoint, grows Wasm memory, and decodes a fresh snapshot from recreated views.
- The Scenario Lab Worker probe exposes readiness, packed event/render metadata, ACK progress, memory-generation counters, and dropped-snapshot metrics as `data-tessera-*` attributes. A browser smoke run is required before the milestone is accepted.

Milestone 3 adds lifecycle and renderer-foundation checks:

- Vitest fakes the Worker and renderer to verify readiness resolution, command routing, snapshot validation/return, metrics requests, fatal startup cleanup, and repeated create-ready-dispose cycles.
- The production build includes modular Babylon core imports and the glTF loader registration while keeping the Rust Worker as the only authority.
- The Scenario Lab browser smoke verifies the Babylon canvas, placeholder scene, active render loop, Worker probe, packed snapshot synchronization, and `pagehide` disposal path. Structured attributes expose render-frame and renderer-snapshot counts alongside the existing boundary metrics.

The foundation still has no camera controls, picking, entity-to-mesh mapping, test bridge, persistence, or gameplay APIs; those remain gated by later milestones.

Run the aggregate `pnpm check` from the repository root after the pinned dependencies are installed. It expands to `pnpm check:format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:rust`, `pnpm check:wasm`, and `pnpm build`. The generated Wasm module is a checked-in application input; inspect its regenerated diff and the staged file list before committing. Milestones 0–3 do not install Playwright, compare visuals, test gameplay, or add a test bridge.

Later milestones add camera/grid/selection behavior, protocol fixtures, Worker boundary tests, Playwright flows, Chromium visuals, Firefox/WebKit smoke coverage, performance harnesses, lifecycle checks, and an isolated external consumer. Those checks are intentionally outside this lifecycle checkpoint.
