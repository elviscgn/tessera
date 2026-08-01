# Architecture

Tessera has one authority boundary: Rust owns authoritative simulation state and gameplay-affecting behavior. TypeScript hosts browser lifecycle, Worker ownership, input translation, persistence adapters, and public presentation APIs. Babylon is a disposable renderer and never becomes a second simulation world.

The planned runtime is a single-threaded Rust/Wasm instance inside a dedicated Worker. Packed commands, events, and render snapshots cross the Worker boundary in coarse batches. The first transport uses transferable buffers; shared memory is a later, explicitly gated option.

Milestone 0 establishes only the repository and build boundary. The four Rust crates are `tessera-core`, `tessera-protocol`, `tessera-wasm`, and `tessera-cli`. Their simulation, protocol, and Wasm behavior is intentionally not implemented yet. See `PLAN.md` for the decision-complete architecture and milestone gates.
