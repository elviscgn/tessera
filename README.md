# Tessera

Tessera is a Rust-authoritative foundation for deterministic, browser-based isometric game systems. The browser host and Babylon renderer are disposable consumers of simulation state; gameplay authority remains in Rust.

The repository is currently at Milestone 0: reproducible toolchains, four Rust crates, strict static checks, and a minimal Vite/Worker build shell. No gameplay runtime exists yet.

- Read the [architecture and delivery plan](PLAN.md) before changing boundaries.
- Follow [local setup](docs/SETUP.md) once Milestone 0 is complete.
- Use the [contribution rules](docs/CONTRIBUTING.md) and [testing guide](docs/TESTING.md).
