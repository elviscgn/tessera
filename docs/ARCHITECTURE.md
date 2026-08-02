# Architecture

Tessera has one important rule: Rust owns the simulation. The browser hosts the runtime and presents its results, but it never becomes a second game state.

```mermaid
flowchart TB
  subgraph consumer["Consumer"]
    app["Ustawi or Scenario Lab"]
  end

  subgraph browser["Browser"]
    api["Public TypeScript API"]
    host["Runtime host"]
    worker["Dedicated Worker"]
    renderer["Babylon.js renderer"]
  end

  subgraph rust["Rust"]
    core["tessera-core"]
    protocol["tessera-protocol"]
    cli["tessera-cli"]
  end

  app --> api
  api --> host
  host -->|commands and controls| worker
  worker -->|Wasm adapter| core
  core -->|events and snapshots| worker
  worker -->|transferable buffers| host
  host --> renderer
  core -. shared formats .- protocol
  cli -. uses .- core
  cli -. uses .- protocol
```

## Runtime responsibilities

| Part              | Responsibility                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Rust core         | Authoritative simulation state and rules; native tests and CLI workflows                              |
| Simulation Worker | One Wasm instance, browser clock, command intake, tick driving, render publication, and Worker errors |
| Browser host      | Canvas, input, public lifecycle, persistence adapters, and derived presentation state                 |
| Babylon renderer  | Scene and visual resources; a disposable projection of Rust state                                     |

The browser main thread communicates with the Worker through versioned transferable buffers. The renderer receives complete snapshots and never writes into Rust memory.

Babylon.js is deliberately disposable. It can be stopped and rebuilt from a complete render snapshot without changing a tick, command result, event sequence, or state hash.

## Rust workspace

The workspace has four crates from the beginning:

- `tessera-core` contains the browser-independent simulation;
- `tessera-protocol` contains the shared wire formats and validators;
- `tessera-wasm` is the narrow Rust/JavaScript adapter;
- `tessera-cli` runs scenarios, replays, checksums, and diagnostics natively.

`tessera-core` does not depend on the protocol crate, browser bindings, Babylon.js, React, or browser storage. The protocol crate is intentionally independent of the browser so the Wasm adapter, CLI, replay tools, and contract tests use the same definitions.

The core uses a generational arena and parallel component stores. An entity is `(slot: u32, generation: u32)`, and renderer mappings reject a stale generation. Active slots are visited in a stable order. This keeps mutation straightforward while making replay, serialization, and native/Wasm comparison explicit.

Placement is indexed separately from the entity arena. A normalized `Footprint` stores sorted integer offsets, and an `OccupancyGrid` maps each expanded `(x, z, elevation)` cell to one generational entity ID. Spawn, move, and remove validate the complete candidate set before mutating either store; a failed claim emits a rejection and leaves the world unchanged. The registry accepts object-specific footprints before work starts and falls back to a one-cell footprint for unregistered object types.

## Authority and determinism

The simulation runs at a fixed 20 Hz. Rust advances ticks; the browser only requests commands, pause/resume, exact steps, or a speed setting. Live commands carry monotonic client sequences and are scheduled for the next unstarted tick. Ordering is `(scheduled tick, client sequence, batch order)`.

Authoritative placement values use signed integer grid coordinates, millimetre elevation, integer footprints, and four quarter-turn rotations. Randomness uses ChaCha8 with a versioned 32-byte seed. Meaningful state is encoded field by field in a canonical little-endian stream and hashed with BLAKE3. Rust memory layout, JSON formatting, Babylon objects, render timing, and diagnostics are not part of the hash.

Invalid and duplicate commands consume their sequence, produce deterministic rejection events, and leave the simulation unchanged. Native replay records the assigned tick and sequence so the same command log can be compared with the Wasm run.

## Worker boundary

The Worker explicitly initializes the `wasm-pack --target web` module, creates one Rust instance, and keeps the browser clock separate from tick semantics. Normal real-time work is bounded; excessive wall-clock debt is discarded and reported instead of being converted into an unbounded catch-up.

Small control messages are versioned requests and responses. Larger traffic uses packed little-endian buffers:

- command batches contain a magic value, protocol version, batch sequence, record count, total length, and TLV records;
- event batches contain fixed-size records and contiguous sequence metadata; the main thread acknowledges only the highest contiguous event;
- render snapshots contain a fixed header and a region table followed by structure-of-arrays data.

Unknown required fields, unsupported flags, malformed lengths, and overlapping regions are rejected before allocation, rendering, or mutation. The event stream is reliable and may request retransmission. Render snapshots are latest-wins and may be dropped under pressure; dropping one never drops a command, tick, or authoritative event.

Wasm memory growth invalidates existing JavaScript views. The Worker compares the memory buffer identity and length on every descriptor read, recreates its views when either changes, increments a memory generation, and copies a complete snapshot into an exclusively owned transferable buffer.

The initial render pool has three reusable buffers with power-of-two capacities. The main thread returns a buffer after it is no longer in use. If all buffers are in flight, the Worker records backpressure and skips visual publication while simulation continues.

## Renderer

Babylon imports are modular, with the glTF loader registered separately. The scene is right-handed and follows glTF conventions: `+X` east, `+Y` up, `+Z` south, and one Babylon unit per metre. Asset pivots are bottom-centred. Camera and footprint rotations are four clockwise quarter-turns.

The renderer owns the engine, scene, camera, lights, materials, meshes, observers, resize listener, and render loop. It records render frames and the last validated snapshot metadata, but it does not own authoritative entities. Later synchronization work will reconcile visual records by slot and generation; a Babylon mesh will never be used to infer gameplay state.

The project starts with ordinary Babylon instances because they support per-instance transforms and picking. Thin instances remain a measured performance experiment, not a default.

The camera is a right-handed orthographic projection aligned with glTF. `+X` is east, `+Y` is up, and `+Z` is south. The presentation camera uses a mathematically symmetric isometric pitch, four clockwise quarter-turns, a target measured in millimetres, and a zoom expressed as visible tile height. Its pure `CameraProjection` model is shared by Babylon synchronization, screen/world/grid conversion, and the coordinate laboratory. Negative world boundaries use floor division, so `-1 mm` belongs to cell `-1` for a `1,000 mm` tile. Camera state remains presentation state and cannot affect Rust hashes or commands.

## Current implementation

Milestones 3 through 5 provide the lifecycle, camera, and occupancy foundation:

- `FoundationRuntime` owns one Worker, one renderer, listeners, pending requests, readiness, diagnostics, and disposal;
- `BabylonRenderer` creates a WebGL2 engine, right-handed scene, temporary camera, light, and one non-pickable placeholder box;
- packed event and render messages are validated before the renderer sees them;
- fatal startup, protocol, Worker, and renderer errors close the runtime and reject pending work;
- `dispose()` is idempotent, including the Scenario Lab `pagehide` path.
- `CameraProjection` provides deterministic grid centres, floor-based cell lookup, four rotations, pan/zoom/focus, and ray-plane conversion;
- the Babylon camera is orthographic and follows the projection model, while Scenario Lab exposes named camera actions and coordinate readouts.
- `Footprint` and `OccupancyGrid` provide normalized integer placement cells, atomic claims/replacements/releases, and a canonical invariant check;
- the render snapshot can carry an optional occupied-cell region, which the browser copies into a disposable grid and translucent cell overlay without making it authoritative.

The public entry point currently exposes lifecycle/readiness primitives and the presentation camera model. Placement commands, picking, entity-to-visual reconciliation, persistence, the development test bridge, and the consumer-facing scenario API are added in later milestones.

## Deliberate exclusions

The first release does not include Ustawi gameplay, networking, physics, mobile/touch input, arbitrary executable scenarios, shared-memory transport, WebGPU requirements, or a consumer-owned Rust plugin ABI. These boundaries are revisited only when measured evidence or a real consumer need justifies them.
