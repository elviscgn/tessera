# Tessera

Tessera is a Rust-authoritative foundation for deterministic, browser-based isometric game systems. The browser host and Babylon renderer are disposable consumers of simulation state; gameplay authority remains in Rust.

The repository is currently at Milestone 2B: a packed render/event data plane, explicit Wasm-memory view generations, a rotating transferable-buffer pool, reliable event ACKs and resynchronization, and native/Wasm parity fixtures inside a dedicated Worker. The Scenario Lab exposes a browser-visible boundary probe; no Babylon renderer or gameplay runtime exists yet.

- Read the [architecture and delivery plan](PLAN.md) before changing boundaries.
- Follow [local setup](docs/SETUP.md) for the pinned Milestone 2B toolchain.
- Use the [contribution rules](docs/CONTRIBUTING.md) and [testing guide](docs/TESTING.md).
