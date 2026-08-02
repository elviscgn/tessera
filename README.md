# Tessera

Tessera is a Rust-powered runtime foundation for deterministic, browser-based isometric games. It is being built for Ustawi, a separate industrialisation and city-building game, but the runtime is intended to be useful to other consumers too.

The central design choice is simple: Rust owns the simulation, while the browser owns the view. A dedicated Worker runs the Rust/Wasm build, and Babylon.js renders the latest state without becoming a second game state.

## Where the project is now

The current implementation has a working native and browser boundary:

- fixed-tick Rust simulation with seeded randomness, generational IDs, replay, and canonical hashes;
- a dedicated Worker with versioned command, event, and render messages;
- transferable render buffers with Wasm memory-growth recovery;
- a Babylon.js engine and scene with a disposable placeholder visual;
- readiness, diagnostics, and deterministic shutdown behaviour.

The next piece is the isometric camera and coordinate conversion. Placement, picking, persistence, the consumer-facing runtime API, and the full Scenario Lab are still in development.

## Runtime responsibilities

| Part              | Owns                                                                               | Does not own                                       |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| Rust core         | Ticks, commands, entities, occupancy, randomness, saves, replay, and hashes        | Browser APIs or rendering                          |
| Simulation Worker | The Wasm instance, clock, message transport, and buffer ownership                  | Gameplay rules or UI state                         |
| Browser host      | Lifecycle, input translation, persistence adapters, and derived presentation state | Authoritative simulation state                     |
| Babylon renderer  | Canvas, scene, camera, meshes, materials, and render-loop resources                | Entity existence, occupancy, or gameplay decisions |

Commands, events, and render snapshots cross the Worker boundary in versioned batches. Render snapshots can be dropped when the renderer is behind; commands and authoritative events cannot.

## Quick start

Tessera is developed against Node 24.18.1 and pnpm 11.19.0. A Rust toolchain and the `wasm32-unknown-unknown` target are also required.

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Open the Scenario Lab at the URL printed by Vite. The full setup and toolchain instructions are in [docs/SETUP.md](docs/SETUP.md).

## Repository layout

| Directory            | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `rust/`              | Simulation, protocol codecs, Wasm adapter, and native CLI                     |
| `src/`               | Public TypeScript surface, Worker integration, renderer, and browser services |
| `apps/scenario-lab/` | Development application for exercising the runtime                            |
| `tests/`             | Unit, integration, browser, visual, and fixture tests                         |
| `docs/`              | Architecture, setup, testing, contribution, and roadmap notes                 |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — runtime ownership and data flow;
- [Setup](docs/SETUP.md) — pinned tools and local commands;
- [Testing](docs/TESTING.md) — test layers and release checks;
- [Contributing](docs/CONTRIBUTING.md) — development and review workflow;
- [Roadmap](docs/ROADMAP.md) — delivered work and the next milestones.

## Scope

Tessera v0.1 is intended to prove a deterministic, reusable isometric runtime and a clean boundary for an external consumer. It is not a networking layer, physics engine, mobile controller, modding system, or complete game. Economy, citizens, production chains, traffic, and other Ustawi-specific systems remain in the consumer.

The project is licensed under the [MIT License](LICENSE).
