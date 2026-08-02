# Testing

Tessera tests the same scenario at several levels: native Rust, the Wasm adapter, the Worker boundary, and the browser view. The goal is to prove state and protocol behaviour first, then use visual checks where appearance is the thing being tested.

## Everyday commands

Use the smallest command that answers the question while developing:

```sh
pnpm test
pnpm typecheck
pnpm quality:fallow
cargo test --manifest-path rust/Cargo.toml --workspace --all-targets
```

Before committing a coherent change, run the complete gate:

```sh
pnpm check
```

`pnpm check` runs formatting, linting, strict TypeScript, Vitest, the pinned Fallow structural audit, Rust Clippy/tests, the reproducible Wasm build, and the Vite production build.

Fallow checks the TypeScript and JavaScript module graph for introduced dead code, duplication, and complexity. It complements ESLint and TypeScript; Rust determinism, protocol validity, native/Wasm parity, and browser behaviour still require their dedicated tests. Inline Fallow suppressions and Fallow config files are intentionally rejected by the repository policy check.

## Native simulation

The Rust suite covers the rules that must be identical in native and browser runs:

- fixed-tick scheduling and command ordering;
- invalid, duplicate, and non-monotonic client sequences;
- generational IDs and stale-handle rejection;
- ChaCha8 reference vectors and seeded random commands;
- canonical BLAKE3 hashes;
- replay across idle ticks and rejected replay order;
- grid, occupancy, footprints, serialization, migration, and invariants as those systems land.

The protocol crate also tests little-endian command/event/render records, lengths, flags, opcodes, region descriptors, and contiguous event sequences.

## Wasm and Worker boundary

The Wasm adapter uses the same command batch as the native probe and compares checkpoint hashes. TypeScript tests cover command encoding, response decoding, structured errors, packed render/event validation, buffer ownership, and memory-view recreation after `WebAssembly.Memory.grow()`.

The Worker checks that:

- the web-target Wasm module is initialized explicitly;
- at most the configured number of exact ticks runs in one call;
- malformed data is rejected before rendering or mutation;
- render buffers are copied into owned transferable storage;
- pool exhaustion drops only visual snapshots;
- event acknowledgements never skip a sequence;
- a changed Wasm memory buffer recreates all host views.

## Browser checks

The Scenario Lab is the first browser smoke target. It checks the canvas, Babylon scene, orthographic camera, named pan/zoom/rotation actions, screen-to-grid readout, render loop, Worker readiness, packed snapshot delivery, event acknowledgement, memory-generation diagnostics, and disposal on `pagehide`.

The probe uses structured `data-tessera-*` attributes so browser tests can assert ticks, hashes, sequence numbers, buffer ownership, and render generations without relying on timing or pixels alone. The known native/Wasm probe hash is:

```text
24ebdfb8bf10251c184a2bcd57d48a6b7d77be51114fbcf75847f77f32adb104
```

Grid, selection, placement, save/load, visual regression, Firefox/WebKit smoke coverage, and the development test bridge are added as their milestones become active.

## Visual tests

The visual museum is intentionally small. A canonical Chromium run fixes the browser revision, viewport, device-pixel ratio, camera, seed, tick, render generation, animation time, fonts, graphics backend, and quality settings. A baseline update needs a reason, before/after artifacts, and unchanged structured state assertions.

## Test discipline

Prefer deterministic fixtures and explicit readiness or tick waits. Do not replace a failing assertion with a sleep, silently update a baseline, disable strict checks, or delete coverage to make a build green. If a failure points to an architectural decision, document the decision rather than hiding the symptom.
