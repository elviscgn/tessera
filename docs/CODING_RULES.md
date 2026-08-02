# Coding rules

These rules keep the simulation deterministic, the browser boundary understandable, and the public package safe to consume.

## Ownership

- Rust owns authoritative state and every gameplay-affecting decision.
- TypeScript owns browser lifecycle, Worker communication, input translation, persistence adapters, and derived presentation state.
- Babylon.js is a view. It must never become a second simulation store or the authority for entity existence.
- Babylon picking may select only a currently mapped visual whose slot and generation came from a validated Rust snapshot.
- `tessera-core` stays independent of browsers, Babylon.js, React, and protocol/Wasm bindings unless an approved design change says otherwise.

## Data and boundaries

- Prefer explicit integer widths, checked inputs, and stable ordering at authority boundaries.
- Keep Worker calls coarse-grained and data-oriented. Do not add per-entity calls to a hot path.
- Keep JSON out of the per-frame render path.
- Treat protocol bytes, save data, asset metadata, and imported scenarios as untrusted input.
- Use versioned formats and fail closed on unknown required fields or malformed lengths.

## TypeScript and Rust

- Keep TypeScript strict. Avoid `any`, unchecked casts, hidden global mutation, and unreviewed public exports.
- Use safe Rust by default. Do not add `unsafe` or suppress a warning simply to get a check passing.
- Keep deterministic logic out of browser clocks, locale-sensitive APIs, random browser helpers, and unstable iteration order.
- Keep visual interpolation and UI state separate from the state hash.
- Treat selection, camera state, screen bounds, and pointer coordinates as presentation state; they never become commands implicitly.
- Treat placement previews as presentation state. A preview may be marked valid only from a Rust placement query, and the authoritative command must validate again.
- Keep public object IDs stable strings. TypeScript may normalize startup declarations, but Rust assigns handles and owns footprints, occupancy, and rejection decisions.

## Dependencies and tests

- Add a dependency only when its purpose, licence, maintenance status, and runtime or build impact are understood.
- Keep tests deterministic. Prefer hashes, protocol records, structured diagnostics, and explicit waits over sleeps.
- A screenshot can support a visual assertion, but it should not be the only evidence for behaviour.
- Update documentation when a public contract, setup step, or architectural boundary changes.

## Change scope

Keep a change limited to one coherent milestone or maintenance task. Do not mix unrelated cleanup into feature work. Review generated Wasm and lockfile changes deliberately.

The current implementation scope includes the Babylon lifecycle, the Worker readiness bridge, the orthographic camera model, named camera actions, coordinate conversion, authoritative grid occupancy, declarative object registration, Rust-backed placement queries and commands, the debug-grid projection, slot/generation selection, deterministic waits, diagnostics, and their tests. React, persistence, gameplay systems, and the test bridge belong to later milestones.
