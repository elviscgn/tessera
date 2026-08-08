# Roadmap

Tessera is delivered in small checkpoints so each release keeps a clear, reviewable story. This page records what is complete, what comes next, and what remains deliberately out of scope.

## Delivered

- **Milestone 0 — repository and tooling:** pinned JavaScript and Rust toolchains, workspace layout, strict checks, and build documentation.
- **Milestone 1 — deterministic Rust core:** fixed ticks, seeded randomness, generational IDs, command ordering, replay, and canonical hashes.
- **Milestone 2A — Wasm/Worker command boundary:** explicit web-target Wasm startup, versioned commands, bounded tick calls, structured errors, and native/Wasm hash parity.
- **Milestone 2B — packed data boundary:** render snapshots, reliable event batches, transferable buffers, memory-growth recovery, and parity fixtures.
- **Milestone 3 — renderer lifecycle:** Babylon engine and scene ownership, Worker readiness, placeholder rendering, diagnostics, and idempotent disposal.
- **Milestone 4 — isometric camera and coordinates:** right-handed orthographic projection, four rotations, pan/zoom/focus, floor-based grid conversion, and the camera laboratory.
- **Milestone 5 — grid and occupancy:** normalized integer footprints, deterministic occupancy claims, atomic move/remove updates, invariant checks, and the packed debug-grid projection.
- **Milestone 6 — picking and selection:** packed entity transforms, stable slot/generation IDs, canvas picking, screen-space bounds, stale-generation protection, and deterministic readiness/tick/render waits.
- **Milestone 7 — placement:** Rust-owned declarative object handles, non-mutating placement queries, presentation-only previews, authoritative placement/move/removal commands, and registry-aware replay fixtures.
- **Milestone 8 — scalable visuals:** visual-type groups backed by ordinary Babylon instances, snapshot removals, world-generation resets, and stale-map diagnostics.
- **Milestone 9 — persistence and replay:** versioned Rust-owned saves, checksum and identity validation, atomic loads, browser persistence adapters, golden fixtures, and native/Wasm replay parity.
- **Milestone 10 — diagnostics and reproduction:** the development test facade, deterministic waits, annotated overlay captures, defensive render inspection, and versioned reproduction manifests.
- **Milestone 11 — Scenario Lab:** nine deterministic laboratories for camera, placement, renderer scale, exact ticks, boundary metrics, persistence, visual scenes, structured failures, and lifecycle resets.
- **Milestone 12 — browser regression:** pinned Playwright flows, canonical Chromium museum visuals, production bridge exclusion smoke, and Firefox/WebKit compatibility smoke.
- **Milestone 13 — performance and cleanup:** native/browser harnesses, lifecycle checks, recorded baselines, and evidence gates for optimization.
- **Milestone 14 — external consumer proof:** an outside-workspace consumer installing the packed artifact through the public export map, reproducing version pinning, and rejecting internal imports.
- **Milestone 15 — first usable release:** validated public documentation, API contracts, package exports, version metadata, protocol compatibility, artifact checksum pinning, known limitations, and the deferred roadmap.

## Next

The v0.1 release surface is complete. The remaining work is owner-level release activity: choose and review the release version, push its matching tag, and inspect the attached artifact and checksum. The tag workflow repeats the release gate and creates the GitHub release; it does not publish to npm. Future consumer-owned Rust gameplay depends on the Ustawi-driven composition decision gate.

## Engine track (M16–M23)

The planned engine track milestones M16–M23 are implemented on the `rust/crates/tessera-arena` crate and its Wasm/session/presentation companions: fixed-point continuous physics (10 fractional bits, i64, pure deterministic integer arithmetic), arena geometry, dynamic bodies, phases and turns, semantic commands, narrow deterministic collision, goals, friction and bounce, bounded resolution, replay, and a canonical state hash. The Wasm adapter proves byte parity against the native engine through a pinned probe hash; a headless CLI match (`tessera-cli arena play`) exercises the vertical slice and verifies replay reproduction; an outside-workspace consumer crate (`examples/arena-external-consumer`) proves the seam via `scripts/check-arena-external-consumer.mjs`. Remaining engine-track consolidation before any tag: full-suite green (Rust, Wasm parity, presentation, session), documentation updates, and issue evidence.

## Planned checkpoints

| Milestone | Focus                                                                                                            | Status                        |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| —         | Post-release owner activity: tag the v0.1 artifact, record release evidence, and review the foundation           | pending owner sign-off         |
| 16        | Audit the engine capabilities required by a continuous tabletop arena and lock the fixed-point/protocol contract | implemented (`tessera-arena` fixed-point + encoding) |
| 17        | Add deterministic arena geometry and continuous transform state                                                  | implemented (`ArenaLayout`, discs, `Vec2`/`Fixed`) |
| 18        | Add dynamic bodies, match phases, turns, and semantic arena commands                                             | implemented (`ArenaSimulation`, phases, turns, commands) |
| 19        | Add narrow deterministic collision, goals, friction, bounce, and bounded resolution                             | implemented (narrow pairs, pockets, restitution, timeouts) |
| 20        | Prove a local Bobble League-like vertical slice with formation, aim, scoring, power plays, and replay            | implemented (`tessera-cli arena play` + tests) |
| 21        | Add arena camera, interpolation, animation, event-driven presentation, and content workflows                     | implemented (`src/presentation/arena`) |
| 22        | Prove an authoritative native session and network-ready command/event semantics                                  | implemented (`ArenaSession`, Wasm parity, rejections) |
| 23        | Prove outside-workspace Rust composition and the engine-track release boundary                                   | implemented (`examples/arena-external-consumer`) |

## Beyond v0.1

The next engine arc is intentionally broader than the current placement laboratory. It uses a Bobble League-like tabletop arena as a validation consumer: players arrange pieces, aim and release a shot, resolve deterministic motion and collisions, score, and replay the result. The arena rules remain consumer-owned; Tessera provides the authoritative runtime, protocol, renderer projection, persistence, and tooling.

Ustawi-specific gameplay remains a separate decision. Once Ustawi has a real Rust gameplay system, Tessera can evaluate a statically composed consumer crate and its versioning boundary. The same rule applies to the arena: no general plugin ABI, dynamic Wasm plugins, or universal gameplay trait is introduced until a local vertical slice and an outside-workspace consumer prove the smallest useful seam.

Physics, networking, mobile/touch input, modding, shared-memory transport, internal Rust parallelism, WebGPU requirements, and a full editor remain outside v0.1. Physics and networking are now planned engine-track work, not promises for the first release; each has a hard parity, replay, performance, and lifecycle gate before it becomes part of a public contract.
