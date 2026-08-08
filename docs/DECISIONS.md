# Decisions

Tessera keeps decisions recorded with their context, alternatives, and reversibility. This page lists the decisions that shaped the current implementation. It is the index; the evidence lives in the referenced milestones, tests, and docs.

## Recorded decisions

### D1 — Rust owns all authoritative simulation state

**Context:** A browser-based isometric game needs a simulation that is deterministic, replayable, and testable without a browser.

**Decision:** Rust is the sole authority for state and gameplay-affecting rules. TypeScript hosts the browser, Worker, input, persistence adapters, and public API; Babylon.js renders disposable projections. TypeScript must not maintain a competing mutable simulation world.

**Alternatives:** JavaScript-owned simulation (rejected: loses native/Wasm parity and replay guarantees); shared authority (rejected: creates drift between two states).

**Evidence:** Native/Wasm parity tests, canonical BLAKE3 hashes, replay fixtures, and the architecture in [ARCHITECTURE.md](ARCHITECTURE.md).

**Reversibility:** Would require redefining determinism and the boundary; treated as locked unless a severe blocker is demonstrated in an ADR.

### D2 — Generational arena with normalized component stores

**Context:** Entity lifecycle needs stable IDs across removal and reuse while keeping iteration deterministic.

**Decision:** An entity ID is `(slot: u32, generation: u32)`. Component stores are parallel vectors indexed by slot, with a stable ascending active-slot list. Freed slots are reused through a deterministic free-list policy.

**Alternatives:** Full ECS/archetype storage (rejected as premature); object-oriented entities (rejected for hidden mutable state); immutable whole-world state (rejected for allocation cost).

**Evidence:** Entity lifecycle, occupancy, and replay tests; milestone 1.

**Reversibility:** Reversible with measured evidence (see plan §11).

### D3 — Right-handed glTF-aligned coordinates, four quarter-turns

**Context:** The renderer and the authoritative grid must agree on one coordinate convention.

**Decision:** `+X` east, `+Y` up, `+Z` south; one Babylon unit per metre; integer millimetres in authoritative state; floor division for negative boundaries; camera and footprint rotations are exactly four clockwise quarter-turns.

**Alternatives:** Left-handed or Y-up conventions from other engines (rejected for glTF compatibility); floating-point authoritative positions (rejected for determinism).

**Evidence:** Camera/coordinate laboratory, grid tests, native tests.

**Reversibility:** A protocol/coordinate version change; locked for v0.1.

### D4 — Fixed 20 Hz ticks with a browser-owned clock

**Context:** Determinism requires tick semantics independent of wall-clock jitter.

**Decision:** Rust advances fixed 20 Hz ticks; speed changes affect scheduling only. Pause, exact stepping, and `1x/2x/4x` are runtime controls, never tick semantics. Wall-time debt is bounded and discarded with diagnostics.

**Alternatives:** Variable timestep (rejected: nondeterministic); JS-driven ticks (rejected: violates D1).

**Evidence:** Simulation tests, determinism fixtures, Scenario Lab stress laboratory.

**Reversibility:** A versioned semantic change; locked for v0.1.

### D5 — Versioned binary protocol with transferable buffers

**Context:** The Worker boundary must be coarse-grained, measurable, and never per-entity.

**Decision:** All traffic is little-endian binary with magic values, a protocol version, TLV records, and fail-closed validation. Render snapshots travel on pooled transferable `ArrayBuffer`s and are latest-wins; events are reliable, sequenced, acknowledged, and never silently dropped. Shared memory is deferred.

**Alternatives:** JSON per frame (rejected: hot-path cost); per-entity Wasm calls (rejected: boundary granularity); `SharedArrayBuffer` first (rejected: requires COOP/COEP).

**Evidence:** Protocol crate tests, boundary laboratory metrics, transfer-pool tests, event-continuity tests.

**Reversibility:** Protocol version 2 would be required for layout changes; the transport can add shared-memory later behind the same protocol.

### D6 — Seeded ChaCha8 randomness and canonical BLAKE3 hashing

**Context:** Randomness and hashing must be deterministic across native and Wasm.

**Decision:** ChaCha8 with a versioned 32-byte seed; canonical little-endian meaningful-state encoding hashed with BLAKE3. The hash excludes renderer objects, UI state, buffer generations, and Rust memory layout.

**Alternatives:** Platform RNG (rejected: nondeterministic); hash of serialized JSON (rejected: not canonical); a weaker checksum (rejected for collision safety).

**Evidence:** RNG tests, state-hash fixtures, native/Wasm parity.

**Reversibility:** Requires a seed/algorithm version change; locked for v0.1.

### D7 — Ordinary Babylon instances, not thin instances

**Context:** Scalable visuals must remain pickable and selectable with stable outlines.

**Decision:** Visual records are grouped by visual type; each group owns one ordinary source mesh and creates ordinary `InstancedMesh` children. Thin instances are deferred until a measured experiment proves selection, lifecycle, and debug behaviour.

**Alternatives:** Thin instances (rejected for now: per-instance selection outline limitations).

**Evidence:** Renderer stress laboratory, visual tests, plan §12.

**Reversibility:** Reversible at the performance milestone with measured proof.

### D8 — Rust-owned versioned JSON saves with atomic loads

**Context:** Persistence must survive corruption, incompatible versions, and failed validation without losing the active world.

**Decision:** Rust serializes a versioned UTF-8 JSON DTO; the envelope carries schema/framework/game/scenario/protocol identity and a BLAKE3 checksum; loads validate into temporary state and swap only on success. Schema migrations are pure functions with golden fixtures, added only when a second schema exists.

**Alternatives:** Binary saves (rejected: harder to debug and migrate); browser-side state rebuild (rejected: violates D1).

**Evidence:** Persistence tests, golden fixtures, save/load laboratory.

**Reversibility:** A new schema version would be added; locked for v0.1.

### D9 — Development-only test bridge, absent in production

**Context:** Rich observability is needed for tests and diagnostics without shipping a test global or a mutation escape hatch.

**Decision:** The `@tessera/runtime/testkit` entry point registers `window.tesseraTest` only in development builds; production builds tree-shake registration and assert the global is absent. The bridge exposes commands and validated queries, never arbitrary mutation.

**Alternatives:** Always-on test API (rejected: production surface); raw Wasm access (rejected: authority leak).

**Evidence:** Production bridge-exclusion smoke, observability tests, plan §17.

**Reversibility:** Additive; entry point can evolve without a breaking change.

### D10 — Four crates from the beginning; no premature plugin ABI

**Context:** The Rust workspace must separate core, wire formats, the Wasm adapter, and native tooling without fragmenting.

**Decision:** One workspace with `tessera-core`, `tessera-protocol`, `tessera-wasm`, and `tessera-cli`. Consumer-owned Rust composition is deferred until Ustawi supplies a real gameplay system; no dynamic plugin ABI or universal gameplay trait.

**Alternatives:** A single mega-crate (rejected: unclear boundaries); a plugin ABI now (rejected: speculative).

**Evidence:** Workspace layout, crate tests, plan §6 and §26.

**Reversibility:** Crate boundaries can be reorganized; the extension seam is an explicit future decision gate.

### D11 — Grow into an engine through a real arena, not a universal abstraction

**Context:** The v0.1 foundation proves deterministic grid interactions, while a Bobble League-like game needs continuous motion, turns, collisions, scoring, replay, and eventually an authoritative session. Adding generic gameplay interfaces before one complete game exists would make the public boundary vague and difficult to change.

**Decision:** Keep v0.1 as the stable grid-first runtime and add a separately gated engine track. Use a small local arena vertical slice as the validation consumer. Match rules, formations, teams, scores, and power plays remain in consumer-owned Rust; Tessera owns the deterministic runtime, protocol, motion foundation, renderer projection, persistence, and test surfaces. Promote a hook or crate only when the local slice and an outside-workspace consumer both require it.

**Alternatives:** Declare Tessera a placement framework forever (rejected: it would prevent a useful class of game); add a universal gameplay trait/plugin ABI now (rejected: no evidence for its shape); make TypeScript/Babylon own arena physics (rejected: breaks native/Wasm parity and replay).

**Evidence (implemented):** Engine-track capability audit (issue #28), deterministic arena replay/hash fixtures, the native arena match with replay reproduction (`tessera-cli arena play`), the Wasm adapter with pinned native-parity hash, the authoritative `ArenaSession` boundary, and the outside-workspace consumer composition check (M23).

**Reversibility:** The engine track is additive. If the arena fails to justify a reusable seam, retain the v0.1 runtime and keep the consumer-specific systems outside the framework.

### D12 — Narrow fixed-point arena physics before general physics

**Context:** A tabletop sports game needs reproducible motion and collisions, but a general physics engine would introduce floating-point and integration risks before the workload is understood.

**Decision:** Arena authority uses versioned signed fixed-point micrometre units with checked arithmetic, wider intermediates, explicit rounding, stable contact ordering, and a scenario-declared deterministic substep count. The first collision model covers dynamic circles against static boundaries and goal volumes, with friction, bounce, impulses, rest thresholds, and a bounded turn budget. Renderer interpolation and Babylon collision helpers remain presentation-only.

**Alternatives:** Use platform floats as authority (rejected: parity and replay risk); adopt a third-party physics engine immediately (rejected: scope and determinism are not yet proven); implement arbitrary mesh collision (rejected: unnecessary for the first vertical slice).

**Evidence (implemented):** geometry/golden tests in `rust/crates/tessera-arena` (fixed-point exactness, sqrt, disc contact), narrow-pair collision determinism, replay-plus-hash parity, native/Wasm byte parity via the pinned parity hash, the CLI's replay-verified arena match, and the outside-workspace consumer probe (M23).

**Reversibility:** The fixed-point unit and protocol are versioned. A measured replacement would require a new protocol/schema version and a replay migration; no silent change is allowed.

## Open decision gates

- Consumer-owned Rust composition (Ustawi-driven, after v0.1).
- Engine-track composition seam after the local arena and outside-workspace proofs.
- Protocol v2 capability negotiation for continuous transforms and semantic arena commands.
- Server-authoritative session versus lockstep/prediction/rollback after offline arena evidence.
- Shared-memory transport adoption (measured evidence required).
- Thin-instance defaulting (measured evidence required).
- npm publishing scope and package name (owner decision pending).
