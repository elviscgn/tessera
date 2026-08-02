import { describe, expect, it, vi } from 'vitest';
import type { FoundationRuntime } from '../../src/browser/foundation-runtime';
import {
  buildAnnotatedOverlayCapture,
  createAnnotatedOverlay,
  createReproductionBundle,
  downloadReproductionManifest,
  normalizeAnnotatedOverlayOptions,
  parseReproductionManifest,
  reproductionManifestEntry,
  registerTesseraTestBridge,
  REPRODUCTION_BUNDLE_FORMAT,
  REPRODUCTION_BUNDLE_VERSION,
  serializeReproductionManifest,
  TesseraTestBridge,
  validateReproductionManifest,
} from '../../src/public/testkit';
import type { FoundationDiagnostics } from '../../src/browser/foundation-runtime';
import type { RenderEntityRecord } from '../../src/worker/data-protocol';
import type { BoundaryMetrics, CommandResultResponse } from '../../src/worker/bridge-protocol';
import type {
  AnnotatedEntity,
  AnnotatedOverlayCapture,
  AnnotatedOverlayCaptureInput,
  AnnotatedOverlayController,
  AnnotatedOverlayOptions,
  NormalizedAnnotatedOverlayOptions,
  ReproductionArtifactKind,
  ReproductionArtifactReference,
  ReproductionBundleInput,
  ReproductionBundleManifest,
  ReproductionCommandRecord,
  ReproductionDirectoryEntry,
  ReproductionEnvironment,
  ReproductionErrorRecord,
  ReproductionHashRecord,
  ReproductionLogRecord,
  ReproductionSnapshotRecord,
  ReproductionCaptureOverrides,
  TesseraTestBridgeDisposer,
  TesseraTestBridgeOptions,
  TestEntityRecord,
  TestSynchronizationState,
} from '../../src/public/testkit';

const diagnostics = (): FoundationDiagnostics => ({
  state: 'ready',
  workerReady: true,
  simulationTick: 4n,
  lastSnapshotGeneration: 2n,
  lastRenderTick: 4n,
  lastEntityCount: 1,
  lastStateHashHex: 'ab'.repeat(32),
  eventStream: {
    highestContiguousSequence: 3n,
    gapCount: 0,
    resyncCount: 0,
    duplicateBatchCount: 0,
    desynced: false,
  },
  renderer: {
    renderFrames: 4,
    receivedSnapshots: 2,
    lastSnapshotGeneration: 2n,
    lastWorldGeneration: 1,
    lastSimulationTick: 4n,
    lastEntityCount: 1,
    occupiedCellCount: 1,
    visibleEntityCount: 1,
    staleMappingCount: 0,
    staleSnapshotCount: 0,
    resetCount: 0,
    visualGroupCount: 1,
    instanceCount: 1,
    disposed: false,
  },
});

const entity = (): RenderEntityRecord => ({
  slot: 2,
  generation: 7,
  x: -1,
  z: 3,
  elevationMm: 500,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
  visualType: 1,
  renderFlags: 0,
});

const fakeCanvas = (): HTMLCanvasElement =>
  ({
    parentElement: null,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  }) as unknown as HTMLCanvasElement;

const bridgeRuntime = (): FoundationRuntime => {
  const commandResult: CommandResultResponse = {
    type: 'command-result',
    requestId: 1,
    batchSequence: 1,
    tick: 1,
    stateHashHex: 'ab'.repeat(32),
    response: new ArrayBuffer(64),
    metrics: {} as BoundaryMetrics,
  };
  return {
    ready: Promise.resolve({
      protocolVersion: 1,
      adapterVersion: 1,
      tick: 0,
      objectTypeHandles: [],
      metrics: {} as BoundaryMetrics,
    }),
    camera: {
      state: { targetMm: { xMm: 0, yMm: 0, zMm: 0 }, rotation: 0, zoomTiles: 12 },
      setState: vi.fn(),
      focusGrid: vi.fn(),
    },
    diagnostics,
    nextClientSequence: () => 1n,
    requestMetrics: () => Promise.resolve({} as BoundaryMetrics),
    renderInspection: () => ({ entities: [entity()], occupiedCells: [] }),
    screenBounds: () => undefined,
    pick: () => undefined,
    selectedEntity: () => undefined,
    waitForSimulationTick: () => Promise.resolve(diagnostics()),
    waitForRenderedTick: () => Promise.resolve(diagnostics()),
    waitForRenderGeneration: () => Promise.resolve(diagnostics()),
    waitForNoPendingErrors: () => Promise.resolve(diagnostics()),
    waitForCommandReceipt: (receipt: Promise<CommandResultResponse>) => receipt,
    step: () => Promise.resolve(commandResult),
    validatePlacement: () =>
      Promise.resolve({
        objectType: 'foundation',
        x: 0,
        z: 0,
        elevationMm: 0,
        rotation: 0,
        valid: true,
        occupiedCellCount: 1,
      }),
    placeObject: () => Promise.resolve(commandResult),
    moveObject: () => Promise.resolve(commandResult),
    removeEntity: () => Promise.resolve(commandResult),
    save: () => Promise.resolve(new Uint8Array()),
    load: () => Promise.resolve({ tick: 0n, stateHashHex: 'ab'.repeat(32), worldGeneration: 1 }),
  } as unknown as FoundationRuntime;
};

describe('development test bridge and reproduction manifests', () => {
  it('keeps the testkit entrypoint explicit and complete', () => {
    const values = [
      TesseraTestBridge,
      createAnnotatedOverlay,
      normalizeAnnotatedOverlayOptions,
      downloadReproductionManifest,
      reproductionManifestEntry,
      REPRODUCTION_BUNDLE_FORMAT,
      REPRODUCTION_BUNDLE_VERSION,
    ];
    const types: readonly unknown[] = [] as readonly (
      | AnnotatedEntity
      | AnnotatedOverlayCapture
      | AnnotatedOverlayCaptureInput
      | AnnotatedOverlayController
      | AnnotatedOverlayOptions
      | NormalizedAnnotatedOverlayOptions
      | ReproductionArtifactKind
      | ReproductionArtifactReference
      | ReproductionBundleInput
      | ReproductionBundleManifest
      | ReproductionCommandRecord
      | ReproductionDirectoryEntry
      | ReproductionEnvironment
      | ReproductionErrorRecord
      | ReproductionHashRecord
      | ReproductionLogRecord
      | ReproductionSnapshotRecord
      | ReproductionCaptureOverrides
      | TesseraTestBridgeDisposer
      | TesseraTestBridgeOptions
      | TestEntityRecord
      | TestSynchronizationState
    )[];
    expect(values).toHaveLength(7);
    expect(types).toHaveLength(0);
  });

  it('builds a serializable annotated capture from validated snapshot records', () => {
    const result = buildAnnotatedOverlayCapture({
      options: {
        enabled: true,
        showEntityIds: true,
        showGridPositions: true,
        showOccupiedCells: true,
        showSelectionBounds: true,
        showCamera: true,
        showDiagnostics: true,
      },
      camera: {
        targetMm: { xMm: 0, yMm: 0, zMm: 0 },
        rotation: 1,
        zoomTiles: 12,
      },
      viewport: { width: 800, height: 600 },
      diagnostics: diagnostics(),
      entities: [entity()],
      occupiedCells: [{ x: -1, z: 3, elevationMm: 500 }],
      boundsForEntity: () => ({
        left: 10,
        top: 20,
        right: 30,
        bottom: 40,
        width: 20,
        height: 20,
      }),
    });

    expect(result).toMatchObject({
      simulationTick: '4',
      renderedTick: '4',
      renderGeneration: '2',
      eventSequence: '3',
      entities: [{ id: '2:7', x: -1, z: 3, bounds: { left: 10 } }],
    });
    expect(result.entities[0]!.bounds?.left).toBe(10);
  });

  it('round-trips versioned manifests and rejects unsafe artifact paths', () => {
    const manifest = createReproductionBundle({
      scenarioId: 'foundation',
      seedHex: '07'.repeat(32),
      frameworkVersion: '0.0.0',
      protocolVersion: 1,
      gameId: 'tessera',
      schemaVersion: 1,
      commands: [
        {
          kind: 'place',
          sequence: '1',
          submittedTick: '0',
          assignedTick: '1',
          exactTicks: 1,
          payload: { objectType: 'foundation', x: 0, z: 0 },
        },
      ],
      snapshots: [],
      hashes: [],
      errors: [],
      logs: [],
      artifacts: [],
      metrics: { renderSnapshots: 1 },
      environment: { viewportWidth: 800, viewportHeight: 600 },
    });
    const roundTrip = parseReproductionManifest(serializeReproductionManifest(manifest));
    expect(roundTrip).toEqual(manifest);

    expect(() =>
      validateReproductionManifest({
        ...manifest,
        artifacts: [{ path: '../secret', kind: 'log', mediaType: 'text/plain' }],
      }),
    ).toThrow('invalid_artifact_path');
    expect(() => parseReproductionManifest('{"format":"tessera.reproduction"}')).toThrow(
      'unsupported_version',
    );
  });

  it('registers and removes the development facade without leaving a global', async () => {
    const previousWindow = globalThis.window;
    const fakeWindow = { devicePixelRatio: 1 } as unknown as Window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });
    const runtime = {
      ready: Promise.resolve({}),
      save: vi.fn(() => Promise.resolve(new Uint8Array())),
      camera: {
        state: { targetMm: { xMm: 0, yMm: 0, zMm: 0 }, rotation: 0, zoomTiles: 12 },
      },
    } as unknown as FoundationRuntime;
    try {
      const dispose = registerTesseraTestBridge(runtime, { canvas: fakeCanvas() });
      expect(fakeWindow.tesseraTest).toBeDefined();
      dispose();
      expect(fakeWindow.tesseraTest).toBeUndefined();
      await Promise.resolve();
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: Window }).window;
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  });

  it('keeps inspection, waits, commands, reset, and capture on one facade', async () => {
    const bridge = new TesseraTestBridge(bridgeRuntime(), {
      canvas: fakeCanvas(),
      scenario: { id: 'default' },
    });
    expect(bridge.ready).toBeDefined();
    expect(bridge.diagnostics().state).toBe('ready');
    await bridge.requestMetrics();
    expect(bridge.renderInspection().entities).toHaveLength(1);
    expect(bridge.entity('2:7')?.x).toBe(-1);
    expect(bridge.occupiedCells()).toEqual([]);
    expect(bridge.visibleEntityIds()).toEqual(['2:7']);
    expect(bridge.screenBounds('2:7')).toBeUndefined();
    expect(bridge.pick({ x: 0, y: 0 })).toBeUndefined();
    expect(bridge.selectedEntity()).toBeUndefined();
    expect(bridge.synchronization().eventSequence).toBe('3');
    await bridge.waitForReady();
    await bridge.waitForSimulationTick(0);
    await bridge.waitForRenderedTick(0);
    await bridge.waitForRenderGeneration(0);
    await bridge.waitForNoPendingErrors();
    await bridge.waitForCommandReceipt(Promise.resolve({} as CommandResultResponse));
    bridge.pause();
    expect(bridge.isPaused()).toBe(true);
    await bridge.step();
    bridge.resume();
    expect(bridge.isPaused()).toBe(false);
    await bridge.validatePlacement({
      objectType: 'foundation',
      x: 0,
      z: 0,
      elevationMm: 0,
      rotation: 0,
    });
    await bridge.placeObject({
      objectType: 'foundation',
      x: 0,
      z: 0,
      elevationMm: 0,
      rotation: 0,
    });
    await bridge.moveObject('2:7', { x: 1, z: 1, elevationMm: 0, rotation: 0 });
    await bridge.removeEntity('2:7');
    await bridge.save();
    await bridge.load(new Uint8Array());
    expect(bridge.listScenarios()).toEqual([{ id: 'default' }]);
    await bridge.loadScenario('default');
    expect(bridge.captureReproductionBundle().scenarioId).toBe('default');
    bridge.dispose();
  });
});
