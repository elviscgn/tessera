# Performance and lifecycle checks

Tessera records performance before it sets performance budgets. The harnesses
measure the native kernel, the Worker/Wasm boundary as exercised by the
Scenario Lab, Babylon snapshot reconciliation, persistence, and repeated
reset/disposal cycles. They are evidence for engineering decisions; a single
machine or a single noisy run is not a release target.

## Local runs

The native harness uses the release Rust CLI:

```
pnpm perf:native
```

The browser harness starts the development Scenario Lab, launches the pinned
Chromium project with a fixed 1280×720 viewport and device pixel ratio, then
records entity population, exact ticks, save/load, and reset cycles:

```
pnpm exec playwright install chromium
pnpm perf:browser
```

Both commands write reports under artifacts/performance/, which is ignored
because reports are runner-specific. A report contains the workload, runner
identity, browser and graphics information where available, warm-up count,
sample count, medians, p95 values, raw samples, and structured state/cleanup
evidence.

## Baselines and comparisons

tests/fixtures/performance/native-baseline.json is a small committed native
reference. It documents the shape of a recorded result and is intentionally
not a universal speed promise. Compare like-for-like runner, toolchain,
workload, browser, graphics backend, viewport, and quality settings:

```
pnpm perf:native:check
```

The comparison reports the median total time. It does not fail by default:
repeat a like-for-like run and add --fail-on-regression when a reviewed
regression decision is ready. The default scheduled workflow uploads trend
artifacts without making one noisy observation fail a pull request.

An optimization needs repeated profiles identifying a material bottleneck and
an isolated experiment with a meaningful improvement. The experiment must
preserve native/Wasm checkpoint hashes, protocol ownership, renderer
rebuildability, and lifecycle cleanup. Shared memory, internal parallelism,
SIMD, alternate allocators, extra Wasm variants, thin-instance adoption, and
WebGPU remain deferred until that evidence exists.

## What is measured

- Native command scheduling, fixed-tick throughput, canonical hashing, save
  encoding, and load validation.
- Continuous arena bodies, deterministic substeps, collision contact counts,
  turn-resolution latency, and replay seek once the engine track begins.
- Browser entity population, exact tick batches, save/load, transferable
  render metrics, snapshot drops, memory-view generations, and render-buffer
  pool pressure.
- Renderer and lifecycle state after repeated reset cycles: visible entities,
  stale mappings, stale snapshots, event synchronisation, and in-flight
  transferable buffers.
- Runner metadata needed to interpret a trend: operating system, architecture,
  browser revision, graphics renderer, viewport, device pixel ratio, locale,
  timezone, seed, scenario, and workload counts.

The browser harness uses only the explicit development testkit surface. It
does not mutate simulation state directly and is never bundled into a
production runtime.

## Arena-track measurements

The arena reference workload records body and collider counts, fixed-point
substeps per tick, contacts tested and resolved, maximum turn duration,
command-to-resolution latency, event bytes, replay seek time, and the share of
visual frames interpolated or dropped. A physics optimization is accepted only
when it preserves checkpoint hashes, collision ordering, replay outcomes,
native/Wasm parity, and cleanup behaviour. The first workload is deliberately
small and narrow; arbitrary mesh collision, prediction, rollback, and hosted
multiplayer are separate decisions rather than hidden performance targets.

## CI cadence

.github/workflows/performance.yml runs manually or on a scheduled cadence.
It installs the pinned toolchain, runs native and Chromium measurements, and
uploads the JSON reports. Performance work is deliberately separate from the
pull-request correctness gate so a noisy hosted runner cannot mask a
determinism or lifecycle regression.

When reviewing a result, look at the raw samples and p95 alongside the median.
Keep the workload and environment unchanged when updating a baseline, record
why the update is needed, and retain the previous report for comparison.
