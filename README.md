# Tessera

Tessera is a Rust-powered foundation for deterministic, browser-based isometric games. The simulation runs in Rust, the browser owns lifecycle and presentation, and Babylon.js renders a disposable view of the latest state.

The first consumer is Ustawi, a separate industrialisation and city-building game. Tessera is being built as a reusable runtime rather than as Ustawi’s gameplay code: economy, citizens, production chains, traffic, and other game-specific systems will live in the consumer.

## Current status

Milestone 3 is complete. The repository currently demonstrates:

- a native Rust simulation and matching Rust/Wasm adapter;
- a dedicated Worker with a versioned binary command, event, and render boundary;
- transferable render buffers with memory-growth recovery;
- a Babylon.js engine and scene with a disposable placeholder visual;
- readiness, diagnostics, and deterministic shutdown behaviour.

The next milestone adds the isometric camera and coordinate conversions. Placement, picking, persistence, the public consumer API, and the Scenario Lab are still ahead on the roadmap.

## Design at a glance

```text
consumer or Scenario Lab
        │ public TypeScript API
        ▼
browser main thread ── transferable buffers ── simulation Worker
        │                                           │
        │ Babylon.js, input, UI                     │ Rust/Wasm
        ▼                                           ▼
presentation state                             Rust simulation
```

Rust is the only source of truth for ticks, commands, entity lifecycle, occupancy, randomness, saves, replays, and state hashes. TypeScript never maintains a second gameplay state. Babylon.js can be discarded and rebuilt from render data without changing the simulation.

## Quick start

Tessera is developed against Node 24.18.1 and pnpm 11.19.0. A Rust toolchain and the `wasm32-unknown-unknown` target are also required.

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Open the Scenario Lab at the URL printed by Vite. The full setup, Rust installation, and version checks are in [docs/SETUP.md](docs/SETUP.md).

## Repository layout

- `rust/` — the deterministic simulation, protocol codecs, Wasm adapter, and native CLI;
- `src/` — the public TypeScript surface, Worker integration, renderer, and browser services;
- `apps/scenario-lab/` — a small application for exercising the runtime;
- `tests/` — unit, integration, browser, visual, and fixture tests as they are added;
- `docs/` — architecture, contribution, testing, and project-maintenance notes.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — the implemented runtime and data flow;
- [Setup](docs/SETUP.md) — pinned tools and local commands;
- [Testing](docs/TESTING.md) — test layers and release checks;
- [Contributing](docs/CONTRIBUTING.md) — how to make and review changes;
- [Roadmap](docs/ROADMAP.md) — delivered work and the next milestones;
- [Architecture and delivery plan](PLAN.md) — the detailed design baseline.

## Scope

Tessera v0.1 is intended to prove a deterministic, reusable isometric runtime and a clean boundary for an external consumer. It is not a networking layer, a physics engine, a mobile controller, a modding system, or a complete game. Those decisions remain deliberately outside the first release.

The project is licensed under the [MIT License](LICENSE).
