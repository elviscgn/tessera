# Tessera

Tessera is a Rust-authoritative foundation for deterministic, browser-based isometric game systems. The browser host and Babylon renderer are disposable consumers of simulation state; gameplay authority remains in Rust.

The repository is currently at Milestone 3: a Babylon.js lifecycle foundation, Worker-backed readiness, one disposable placeholder visual, render-loop diagnostics, and the packed Rust/Wasm boundary. Camera, picking, gameplay, and entity-to-visual reconciliation remain later milestones.

- Read the [architecture and delivery plan](PLAN.md) before changing boundaries.
- Follow [local setup](docs/SETUP.md) for the pinned Milestone 3 toolchain.
- Use the [contribution rules](docs/CONTRIBUTING.md) and [testing guide](docs/TESTING.md).
