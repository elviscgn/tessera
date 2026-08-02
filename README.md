# Tessera

Tessera is a Rust-authoritative foundation for deterministic, browser-based isometric game systems. The browser host and Babylon renderer are disposable consumers of simulation state; gameplay authority remains in Rust.

The repository is currently at Milestone 2A: reproducible toolchains, a native deterministic kernel, a versioned command/response codec, and an explicit web-target Wasm instance inside a dedicated Worker. The Scenario Lab exposes only a browser-visible control-boundary probe; no renderer or gameplay runtime exists yet.

- Read the [architecture and delivery plan](PLAN.md) before changing boundaries.
- Follow [local setup](docs/SETUP.md) for the pinned Milestone 2A toolchain.
- Use the [contribution rules](docs/CONTRIBUTING.md) and [testing guide](docs/TESTING.md).
