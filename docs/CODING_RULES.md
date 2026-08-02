# Coding rules

- Keep gameplay authority in Rust. TypeScript must not maintain a competing mutable simulation world.
- Keep `tessera-core` independent of browsers, Babylon, React, and protocol or Wasm bindings unless a later approved milestone says otherwise.
- Prefer explicit integer widths, deterministic ordering, and checked inputs at authority boundaries.
- Keep Worker calls coarse-grained and data-oriented. Do not add per-entity hot-path calls or hot-path JSON.
- Use strict TypeScript. Do not introduce casual `any`, unchecked casts, hidden global mutation, or unreviewed public exports.
- Use safe Rust by default. Do not add casual `unsafe` or suppress warnings to make a check pass.
- Add dependencies only when their purpose, license, runtime impact, and maintenance cost are understood.
- Keep tests deterministic and use structured state instead of sleeps or screenshots alone.
- Change only the files owned by the active milestone and commit each working checkpoint with a short lowercase message.

The current checkpoint is the Milestone 3 lifecycle foundation. Keep additions limited to Babylon engine/scene ownership, the explicit Worker readiness/synchronization bridge, one placeholder visual, lifecycle diagnostics, and deterministic tests. Do not add camera controls, picking, entity-to-visual mappings, React, persistence, gameplay systems, or test-bridge globals until later milestones are approved.
