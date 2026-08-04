# Assets

This page records how Tessera treats visual assets. The governing rule is that assets are presentation input, never authoritative state: a texture, material, GLB path, animation name, shadow, or display setting must not change the simulation state hash.

## Manifest contract

Consumers declare visual assets declaratively through the public runtime options. The `AssetManifest` type at the public entry point is a plain data record:

```ts
import { type AssetManifest } from '@tessera/runtime';

const manifest: AssetManifest = {
  assets: [{ id: 'warehouse', url: '/assets/warehouse.glb' }],
};
```

An `AssetManifestEntry` has a stable consumer-owned `id` and a consumer-resolved `url`. The runtime treats these records as presentation input: it never sends them to Rust as gameplay state, and Rust never hashes them.

Asset identity is deliberately separate from authoritative object identity. A consumer's declarative object definitions and their visual assets may share the same readable ID, but the authoritative registry lives in Rust while the asset manifest is browser-owned presentation metadata. Simulation definitions that affect rules (footprint, occupancy, capabilities, authoritative type ID) and visual definitions (GLB assets, materials, animation names, shadows, display metadata) are never mixed in one source of truth.

## Current state

- The public `AssetManifest` and `AssetManifestEntry` types are part of the export contract and covered by unit tests.
- Babylon's glTF loader is registered at runtime as a side-effect module (`src/renderer/register-loaders.js`), declared in the package `sideEffects` field so bundlers keep it.
- The renderer currently creates disposable placeholder visuals (a per-visual-type template with ordinary instances) when no loaded asset is associated with a visual type. The authoritative world never depends on which visual appears.

Loading GLB files through the manifest and mapping a loaded `AssetContainer` to a visual type is a later milestone, not yet implemented. Until then, `url` values in a manifest are recorded but not fetched by the runtime.

## Coordinate and scale conventions

When GLB assets are consumed, the scene follows the conventions used everywhere in Tessera:

- Right-handed coordinate system aligned with glTF: `+X` is east, `+Y` is up, `+Z` is south.
- One Babylon unit is one metre. A scenario chooses a positive integer millimetres-per-tile scale; the renderer converts millimetres to Babylon units by that scale.
- Asset pivots are bottom-centre. Camera and footprint rotations are exactly four clockwise quarter-turns (`r0..r3`).
- Cell `(x, z)` owns the half-open world rectangle `[x * tile, (x + 1) * tile) × [z * tile, (z + 1) * tile)` in integer millimetres, with its visual centre at `((x + 0.5) * tile, elevation, (z + 0.5) * tile)`.
- Footprint cells are rotated by the canonical quarter-turn table and translated from the anchor cell; elevation stays an integer millimetre value.

These rules are shared by Rust tests and the browser laboratory so that a model imported from a GLB appears where the authoritative grid says it is.

## Validation and trust

Treat asset metadata and paths as untrusted input:

- Asset paths must be relative or explicitly allowlisted. Arbitrary network paths are not accepted by default.
- A manifest entry with an unknown ID, malformed URL, or unsupported media type is rejected or ignored with a structured diagnostic; it must never be executed as code.
- GLB content is parsed only by the renderer for presentation. If a model fails to load, the runtime falls back to the placeholder visual rather than blocking simulation.
- Assets are never sent across the Rust/Wasm boundary as gameplay state, and asset bytes never participate in a state hash, replay, or save.

## Licensing

Every asset needs a recorded licence before it enters the repository or a release:

- Prefer assets with permissive licences that allow redistribution in the MIT-licensed runtime and its examples.
- Record provenance (source, author, licence, link) for each committed GLB, texture, or material next to the asset.
- Do not commit assets with unknown provenance or incompatible licence terms.
- The Scenario Lab visual museum must keep its asset set small and documented so baselines stay reproducible.

## Fallback

The renderer must remain buildable from snapshots even when assets are missing, renamed, or failing to load:

- A missing visual asset produces the placeholder visual for that visual type and a diagnostic; it never removes the entity from the world.
- Snapshot reconciliation is keyed by slot and generation, not by asset identity, so an asset swap never reorders or duplicates authoritative entities.
- Visual-only changes (texture, material, GLB path, animation name, shadow, display settings) must not change the authoritative simulation hash; this is asserted by the test suite.
