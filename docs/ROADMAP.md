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

The v0.1 release surface is complete. The remaining work is owner-level release activity: running the GitHub release gate on the merged branch, attaching the pinned artifact and checksum to a tag, and preparing the separate Milestone 1 task when the foundation review accepts the evidence. Future consumer-owned Rust gameplay depends on the Ustawi-driven composition decision gate.

## Planned checkpoints

| Milestone | Focus                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| —         | Post-release owner activity: tag the v0.1 artifact, record release evidence, and review the foundation |

## Beyond v0.1

Ustawi-specific gameplay remains a separate decision. Once Ustawi has a real Rust gameplay system, Tessera can evaluate a statically composed consumer crate and its versioning boundary. Tessera will not introduce a general plugin ABI, dynamic Wasm plugins, or a universal gameplay trait before that evidence exists.

Networking, mobile/touch input, modding, shared-memory transport, internal Rust parallelism, WebGPU requirements, and a full editor are also outside the first release.
