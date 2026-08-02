# Coding rules

These rules keep the simulation deterministic, the browser boundary understandable, and the public package safe to consume.

## Ownership

- Rust owns authoritative state and every gameplay-affecting decision.
- TypeScript owns browser lifecycle, Worker communication, input translation, persistence adapters, and derived presentation state.
- Babylon.js is a view. It must never become a second simulation store or the authority for entity existence.
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

## Dependencies and tests

- Add a dependency only when its purpose, licence, maintenance status, and runtime or build impact are understood.
- Keep tests deterministic. Prefer hashes, protocol records, structured diagnostics, and explicit waits over sleeps.
- A screenshot can support a visual assertion, but it should not be the only evidence for behaviour.
- Update documentation when a public contract, setup step, or architectural boundary changes.

## Change scope

Keep a change limited to one coherent milestone or maintenance task. Do not mix unrelated cleanup into feature work. Review generated Wasm and lockfile changes deliberately.

The current implementation scope includes the Babylon lifecycle, the Worker readiness bridge, the placeholder scene, the pure orthographic camera model, named camera actions, coordinate conversion, authoritative grid occupancy, the debug-grid projection, diagnostics, and their tests. Picking, entity-to-visual mappings, React, persistence, gameplay systems, and the test bridge belong to later milestones.
