# Observability

Tessera exposes diagnostics as part of the runtime contract, not as a second
simulation API. The browser can inspect what Rust has published, wait for a
known boundary, and collect enough context to reproduce a failure. It cannot
write occupancy, entities, randomness, or ticks directly.

## Development test surface

The Scenario Lab registers the development-only `window.tesseraTest` facade.
The public entry point is kept separate so a consumer can opt into it in a
development build:

```ts
import { registerTesseraTestBridge } from '@tessera/runtime/testkit';

const unregister = registerTesseraTestBridge(runtime, { canvas });
// unregister() removes the global and its overlay listeners.
```

The facade provides:

- readiness, simulation-tick, rendered-tick, render-generation, command-receipt,
  and no-error waits;
- pause, resume, exact stepping, reset, scenario listing, and scenario restart;
- validated entity records, occupied cells, stable IDs, picking, screen bounds,
  selection, camera state, and synchronization metrics;
- placement queries and the same placement, move, and removal commands exposed
  to a consumer;
- annotated overlay controls and a serializable overlay capture; and
- reproduction-manifest capture with hashes, snapshots, commands, diagnostics,
  environment metadata, and artifact references.

Every query returns a copy or an immutable description. The bridge does not
expose the Worker, Wasm memory, Babylon scene, or an arbitrary mutation hook.

Production builds do not register the global. The Scenario Lab guards the
registration with the build mode flag, and the production bundle check must
assert that `window.tesseraTest` is absent.

## Annotated overlays

The overlay is intentionally plain DOM. It is positioned above the canvas and
is safe to remove and recreate without touching Babylon. When enabled it can
show:

- `slot:generation` entity IDs and their integer grid positions;
- screen-space selection bounds;
- occupied-cell count;
- camera rotation, zoom, and target; and
- simulation/render ticks, snapshot generation, event continuity, and the
  latest state hash.

Overlay data is derived from the most recent validated render snapshot. A
missing or stale snapshot is visible as missing data; it is never filled in
from a browser-side entity cache.

## Reproduction directories

A reproduction is a directory with a versioned `manifest.json`. The manifest
records the scenario and seed, ordered commands with their sequence and tick,
checkpoint snapshots and state hashes, structured errors, browser/Worker logs,
metrics, and environment information. Screenshots, visual diffs, traces, and
other large files live beside the manifest and are referenced by relative paths
and media types.

The directory format is deliberately transparent:

```text
reproduction/
├── manifest.json
├── screenshots/scene.png
├── traces/run.zip
└── logs/worker.ndjson
```

Artifact paths are relative and cannot contain `..`, empty segments, absolute
paths, or backslashes. A manifest is validated before it is downloaded,
replayed, or handed to a directory writer. The browser treats all save bytes,
logs, screenshots, and traces as opaque data; it does not execute a referenced
file.

The manifest codec is dependency-free and available from
`@tessera/runtime/testkit`. A native replay command will consume the same
directory format, so a failure captured in Chromium remains useful to native
parity checks.

## What belongs in a report

Include the smallest reproduction directory that demonstrates the failure:

1. the manifest and the exact command used to collect it;
2. the first failing checkpoint hash or structured error;
3. a screenshot or trace only when it adds information beyond the state data;
4. browser, viewport, device-pixel-ratio, graphics backend, and quality
   settings; and
5. whether the failure reproduces in native Rust, Wasm, Chromium, or a smoke
   browser.

Do not include credentials, cookies, filesystem paths, unrelated save files,
or user data in a bundle. Review artifact references and logs before sharing a
directory outside the development machine.
