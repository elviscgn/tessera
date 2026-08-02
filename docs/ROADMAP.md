# Roadmap

Tessera is delivered in small checkpoints so each release keeps a clear, reviewable story. This page records what is complete, what comes next, and what remains deliberately out of scope.

## Delivered

- **Milestone 0 — repository and tooling:** pinned JavaScript and Rust toolchains, workspace layout, strict checks, and build documentation.
- **Milestone 1 — deterministic Rust core:** fixed ticks, seeded randomness, generational IDs, command ordering, replay, and canonical hashes.
- **Milestone 2A — Wasm/Worker command boundary:** explicit web-target Wasm startup, versioned commands, bounded tick calls, structured errors, and native/Wasm hash parity.
- **Milestone 2B — packed data boundary:** render snapshots, reliable event batches, transferable buffers, memory-growth recovery, and parity fixtures.
- **Milestone 3 — renderer lifecycle:** Babylon engine and scene ownership, Worker readiness, placeholder rendering, diagnostics, and idempotent disposal.
- **Milestone 4 — isometric camera and coordinates:** right-handed orthographic projection, four rotations, pan/zoom/focus, floor-based grid conversion, and the camera laboratory.

## Next

**Milestone 5 — grid and occupancy** is the next implementation checkpoint. It will add authoritative occupancy, integer footprints, elevation invariants, and placement-cell visualization.

## Planned checkpoints

| Milestone | Focus                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| 5         | Grid cells, occupancy, footprints, elevation, and rotation invariants                                                |
| 6         | Picking, stable selection IDs, screen-space bounds, and synchronization waits                                        |
| 7         | Placement preview, Rust validation, placement/removal commands, and replay                                           |
| 8         | Entity-to-visual reconciliation, grouping, removal, reset generations, and stale-map diagnostics                     |
| 9         | Snapshots, replay, save/load, schema checks, migrations, and parity fixtures                                         |
| 10        | Development diagnostics, stable waits, annotated overlays, and reproduction bundles                                  |
| 11        | Scenario Lab and its deterministic camera, placement, stress, persistence, visual, error, and lifecycle laboratories |
| 12        | Playwright flows, Chromium visual regression, production smoke, and Firefox/WebKit compatibility smoke               |
| 13        | Native/browser performance harnesses, cleanup checks, baselines, and optimization evidence                           |
| 14        | Outside-workspace consumer fixture, packed artifact checks, and reproducible version pinning                         |
| 15        | First usable release validation, documentation, limitations, checksums, and tagged artifacts                         |

## Beyond v0.1

Ustawi-specific gameplay remains a separate decision. Once Ustawi has a real Rust gameplay system, Tessera can evaluate a statically composed consumer crate and its versioning boundary. Tessera will not introduce a general plugin ABI, dynamic Wasm plugins, or a universal gameplay trait before that evidence exists.

Networking, mobile/touch input, modding, shared-memory transport, internal Rust parallelism, WebGPU requirements, and a full editor are also outside the first release.
