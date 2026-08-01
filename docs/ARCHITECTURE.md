# Architecture

Tessera has one authority boundary: Rust owns authoritative simulation state and gameplay-affecting behavior. TypeScript hosts browser lifecycle, Worker ownership, input translation, persistence adapters, and public presentation APIs. Babylon is a disposable renderer and never becomes a second simulation world.

The planned runtime is a single-threaded Rust/Wasm instance inside a dedicated Worker. Packed commands, events, and render snapshots cross the Worker boundary in coarse batches. The first transport uses transferable buffers; shared memory is a later, explicitly gated option.

Milestone 0 established the repository and build boundary. Milestone 1 now implements the native portion of that authority boundary in `tessera-core`; the protocol, Wasm adapter, browser Worker, and renderer remain later milestones. The four Rust crates are `tessera-core`, `tessera-protocol`, `tessera-wasm`, and `tessera-cli`.

The native kernel uses a generational arena with `(slot: u32, generation: u32)` identities, normalized component stores for object handles and integer grid transforms, and deterministic lowest-slot reuse. A scenario has an immutable 20 Hz configuration and a versioned 32-byte ChaCha8 seed. Commands carry client sequence numbers, are assigned to the next unstarted tick, and execute in `(scheduled tick, sequence, batch order)` order. Invalid and duplicate commands consume their sequence and emit deterministic rejection events without mutating entities.

Meaningful state is encoded explicitly as little-endian fields with a domain prefix and version before BLAKE3 hashing. The encoding includes scheduler, entity, seed, RNG draw-count, and pending-command state; it never hashes Rust memory layout, event-log storage, or JSON. Native replay uses the assigned tick and sequence records to reproduce checkpoint hashes without a browser.
