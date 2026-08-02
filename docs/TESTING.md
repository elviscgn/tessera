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
- normalized footprints, rotated cell expansion, atomic occupancy claims, overlap rejection, move/remove release, and entity/occupancy invariants;
- sorted public object registries, non-mutating placement queries, deterministic rejection reasons, and replay with the same footprint registry;
- canonical Rust-owned save DTO bytes and BLAKE3 checksums;
- save/load round trips that preserve meaningful state, replay records, event history, and hashes;
- golden save fixtures, corrupted/checksum failures, wrong-game and wrong-scenario imports, unsupported schema results, and invalid registry/occupancy references;
- RNG cursor restoration after a save/load round trip, so future random commands remain identical.

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
- a changed Wasm memory buffer recreates all host views;
- save and load requests use defensive transferable ownership, and a failed load does not change the active tick or state hash;
- a successful load resets event acknowledgement and publishes a new world-generation snapshot.

## Browser checks

The Scenario Lab is the first browser smoke target. It checks the canvas, Babylon scene, orthographic camera, named pan/zoom/rotation actions, screen-to-grid readout, render loop, Worker readiness, packed snapshot delivery, event acknowledgement, memory-generation diagnostics, entity picking, selected-ID display, screen-space bounds, Rust-backed placement previews, placement/removal controls, and disposal on `pagehide`.

The probe uses structured `data-tessera-*` attributes so browser tests can assert ticks, hashes, sequence numbers, buffer ownership, and render generations without relying on timing or pixels alone. The known native/Wasm probe hash is:

```text
1d58e8e0cf937e92279a5206ca3d4e8d24b046b9545568695bc262dd0ed4967c
```

The render probe also validates the authoritative occupied-cell region, entity transform regions, and their typed-array decoders. Unit coverage rejects malformed entity layouts, duplicate slots, invalid generations, and stale selection handles. Browser smoke selects the rendered probe entity and checks that its `slot:generation` ID and canvas-relative bounds appear in the lab. Persistence tests exercise the public adapter boundary and the Worker save/load responses; visual regression, Firefox/WebKit smoke coverage, and the development test bridge are added as their milestones become active.

Renderer reconciliation has pure unit coverage for slot updates, missing-entity removals, generation replacement, visual-type regrouping, newer-world resets, and stale snapshot rejection. Renderer diagnostics expose visual-group count, instance count, reset count, stale mapping count, and stale snapshot count so a browser stress run can prove that dropped or late projections do not resurrect presentation state.

## Visual tests

The visual museum is intentionally small. A canonical Chromium run fixes the browser revision, viewport, device-pixel ratio, camera, seed, tick, render generation, animation time, fonts, graphics backend, and quality settings. A baseline update needs a reason, before/after artifacts, and unchanged structured state assertions.

## Test discipline

Prefer deterministic fixtures and explicit readiness or tick waits. Do not replace a failing assertion with a sleep, silently update a baseline, disable strict checks, or delete coverage to make a build green. If a failure points to an architectural decision, document the decision rather than hiding the symptom.
