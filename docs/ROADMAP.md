# Roadmap

The complete milestone sequence and stop conditions live in `PLAN.md`.

Current status:

- Milestone 0 — repository and tooling foundation: delivered.
- Milestone 1 — native Rust deterministic core: delivered.
- Milestone 2A — coarse Wasm/Worker command and hash boundary: delivered.
- Milestone 2B — packed data, memory-growth recovery, transferable buffer pool, and parity fixtures: not started.
- Later milestones — renderer, camera, grid, placement, persistence, test bridge, Scenario Lab, browser compatibility, performance, external consumer, and release validation: deferred.

The Ustawi-driven Rust composition decision remains intentionally deferred until a real consumer gameplay system exists. Milestone 2 remains the architecture gate: no renderer or framework feature work may begin until 2B proves packed data, memory-growth recovery, transferable-buffer ownership, structured errors, and native/Wasm state-hash parity. Milestone approval is required before advancing.
