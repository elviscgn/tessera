import {
  CameraActionLayer,
  createFoundationRuntime,
  SelectionActionLayer,
  viewportForCanvas,
  type FoundationDiagnostics,
  type FoundationRuntime,
  type ScreenBounds,
} from '../../../src/public/index';
import {
  downloadReproductionManifest,
  registerTesseraTestBridge,
  type TesseraTestBridge,
} from '../../../src/public/testkit';
import {
  errorMessage,
  formatBytes,
  formatCount,
  formatHash,
  gridForIndex,
  LAB_DEFINITIONS,
  OBJECT_TYPES,
  objectTypeById,
  SCENARIO,
  SEED,
  SEED_HEX,
  targetAt,
  type LabId,
} from './lab-model';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Scenario Lab mount is missing ${selector}`);
  }
  return element;
};

const text = (selector: string, value: string): void => {
  required<HTMLElement>(selector).textContent = value;
};

type ResultTone = 'neutral' | 'positive' | 'info' | 'danger';
type ErrorProbeKind = 'invalid-placement' | 'unknown-entity' | 'step-guard';

const fallbackText = (value: string | undefined, fallback: string): string =>
  value === undefined ? fallback : value;

const result = (selector: string, value: string, tone: ResultTone = 'neutral'): void => {
  const element = required<HTMLElement>(selector);
  element.textContent = value;
  if (tone === 'neutral') {
    delete element.dataset.tone;
  } else {
    element.dataset.tone = tone;
  }
};

const errorParts = (
  error: unknown,
): { readonly code: string; readonly phase: string; readonly message: string } => {
  const message = errorMessage(error);
  const match = /^tessera:([^:]+):([^:]+):(.*)$/u.exec(message);
  if (match === null) {
    return { code: 'unstructured_exception', phase: 'unknown', message };
  }
  return {
    phase: fallbackText(match[1], 'unknown'),
    code: fallbackText(match[2], 'unknown_error'),
    message: fallbackText(match[3], message),
  };
};

const formatBounds = (bounds: ScreenBounds | undefined): string => {
  if (bounds === undefined) {
    return '—';
  }
  return `${Math.round(bounds.left)},${Math.round(bounds.top)} ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
};

const worldWasPreserved = (before: FoundationDiagnostics, after: FoundationDiagnostics): boolean =>
  before.simulationTick === after.simulationTick &&
  before.lastStateHashHex === after.lastStateHashHex;

const corruptedSave = (bytes: Uint8Array): Uint8Array => {
  const copy = bytes.slice();
  const lastIndex = copy.length - 1;
  copy[lastIndex] = (copy[lastIndex] ?? 0) ^ 0xff;
  return copy;
};

const isLabId = (value: string): value is LabId =>
  LAB_DEFINITIONS.some((definition) => definition.id === value);

const app = required<HTMLElement>('#app');
const canvas = required<HTMLCanvasElement>('#renderCanvas');
const status = required<HTMLOutputElement>('#status');
const telemetry = required<HTMLElement>('#telemetry');
const placementObjectType = required<HTMLSelectElement>('#placementObjectType');
const placementButton = required<HTMLButtonElement>('[data-placement-action="place"]');
const overlayEnabled = required<HTMLInputElement>('#overlayEnabled');

for (const definition of OBJECT_TYPES) {
  const option = document.createElement('option');
  option.value = definition.id;
  option.textContent = definition.id;
  placementObjectType.append(option);
}

const setStatusDetails = (details: Readonly<Record<string, string>>): void => {
  for (const [key, value] of Object.entries(details)) {
    const datasetKey = `tessera${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`;
    status.dataset[datasetKey] = value;
    telemetry.dataset[datasetKey] = value;
  }
};

const setStatus = (value: string, details: Readonly<Record<string, string>> = {}): void => {
  status.dataset.tesseraStatus = value;
  telemetry.dataset.tesseraStatus = value;
  setStatusDetails(details);
  status.textContent = details.tick === undefined ? `Tessera ${value}` : `tick ${details.tick}`;
};

const clockLabel = (testBridge: TesseraTestBridge | undefined): string =>
  testBridge === undefined ? 'exact mode' : testBridge.isPaused() ? 'paused' : 'running';

const setActiveLab = (id: LabId): void => {
  app.dataset.tesseraActiveLab = id;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lab-tab]')) {
    const selected = button.dataset.labTab === id;
    button.setAttribute('aria-selected', String(selected));
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-lab-panel]')) {
    panel.dataset.active = String(panel.dataset.labPanel === id);
  }
  const definition = LAB_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition !== undefined) {
    required<HTMLElement>('#labContext').textContent =
      `${definition.eyebrow} · ${definition.description}`;
  }
};

const setCameraReadouts = (
  runtime: FoundationRuntime,
  pointerCell?: { x: number; z: number },
): void => {
  const state = runtime.camera.state;
  const viewport = viewportForCanvas(canvas);
  text('#cameraRotation', `r${state.rotation}`);
  text('#cameraZoom', `${state.zoomTiles.toFixed(1)} tiles`);
  text(
    '#cameraTarget',
    `${Math.round(state.targetMm.xMm)}, ${Math.round(state.targetMm.yMm)}, ${Math.round(state.targetMm.zMm)}`,
  );
  text('#cameraViewport', `${Math.round(viewport.width)} × ${Math.round(viewport.height)}`);
  text('#pointerCell', pointerCell === undefined ? '—' : `${pointerCell.x}, ${pointerCell.z}`);
  text(
    '#placementPointerCell',
    pointerCell === undefined ? '—' : `${pointerCell.x}, ${pointerCell.z}`,
  );
  telemetry.dataset.tesseraCameraRotation = `r${state.rotation}`;
  telemetry.dataset.tesseraCameraZoomTiles = String(state.zoomTiles);
  telemetry.dataset.tesseraCameraTargetMm = `${state.targetMm.xMm},${state.targetMm.yMm},${state.targetMm.zMm}`;
  telemetry.dataset.tesseraPointerCell =
    pointerCell === undefined ? '' : `${pointerCell.x},${pointerCell.z}`;
};

const setPlacementDefinitionReadout = (objectType: string): void => {
  const definition = objectTypeById(objectType);
  const footprint = definition.footprint?.length ?? 1;
  text('#placementFootprint', `${footprint} ${footprint === 1 ? 'cell' : 'cells'}`);
};

type RuntimeMetrics = NonNullable<FoundationDiagnostics['metrics']>;

const metricValue = <K extends keyof RuntimeMetrics>(
  metrics: RuntimeMetrics | undefined,
  key: K,
): RuntimeMetrics[K] | undefined => (metrics === undefined ? undefined : metrics[key]);

const formatInFlightBuffers = (metrics: RuntimeMetrics | undefined): string =>
  metrics === undefined
    ? '—'
    : `${metrics.inFlightRenderBuffers} / ${metrics.renderBufferPoolSize}`;

const rendererCount = (value: number | undefined): number => (value === undefined ? 0 : value);

const errorField = (error: FoundationDiagnostics['lastError'], field: 'code' | 'phase'): string =>
  error === undefined ? '—' : error[field];

const setBoundaryMetricReadouts = (metrics: FoundationDiagnostics['metrics']): void => {
  const typedMetrics = metrics;
  text('#metricCommandCalls', formatCount(metricValue(typedMetrics, 'commandCalls')));
  text('#metricCommandBytes', formatBytes(metricValue(typedMetrics, 'commandBytes')));
  text('#metricRenderSnapshots', formatCount(metricValue(typedMetrics, 'renderSnapshots')));
  text('#metricDroppedSnapshots', formatCount(metricValue(typedMetrics, 'droppedRenderSnapshots')));
  text('#metricInFlightBuffers', formatInFlightBuffers(typedMetrics));
  text('#metricMemoryGeneration', formatCount(metricValue(typedMetrics, 'memoryGeneration')));
  text('#metricViewRecreations', formatCount(metricValue(typedMetrics, 'viewRecreations')));
  text('#metricEventGaps', formatCount(metricValue(typedMetrics, 'eventGapCount')));
};

const setRendererReadouts = (
  runtime: FoundationRuntime,
  diagnostics: FoundationDiagnostics,
): void => {
  const renderer = diagnostics.renderer;
  text('#occupiedCells', formatCount(renderer.occupiedCellCount));
  text('#selectedEntity', diagnostics.selectedEntityId ?? '—');
  const bounds =
    diagnostics.selectedEntityId === undefined
      ? undefined
      : runtime.screenBounds(diagnostics.selectedEntityId);
  text('#selectionBounds', formatBounds(bounds));
  text('#stressEntityCount', formatCount(renderer.visibleEntityCount));
  text('#stressGroupCount', formatCount(renderer.visualGroupCount));
  text('#stressInstanceCount', formatCount(renderer.instanceCount));
  text('#stressStaleMappings', formatCount(renderer.staleMappingCount));
};

const setSimulationReadouts = (diagnostics: FoundationDiagnostics): void => {
  text('#simulationTick', diagnostics.simulationTick.toString());
  text('#simulationHash', formatHash(diagnostics.lastStateHashHex));
  text('#simulationEvents', diagnostics.eventStream.highestContiguousSequence.toString());
  text('#simulationClock', 'running');
};

const setMuseumAndLifecycleReadouts = (diagnostics: FoundationDiagnostics): void => {
  const renderer = diagnostics.renderer;
  text('#museumWorldGeneration', String(renderer.lastWorldGeneration));
  text('#museumSnapshotGeneration', diagnostics.lastSnapshotGeneration.toString());
  text('#museumRenderFrames', formatCount(renderer.renderFrames));
  text('#museumResetCount', formatCount(renderer.resetCount));
  text('#lifecycleWorldGeneration', String(renderer.lastWorldGeneration));
  text('#lifecycleStaleMappings', formatCount(renderer.staleMappingCount));
  text('#currentHash', formatHash(diagnostics.lastStateHashHex));
};

const setErrorReadouts = (diagnostics: FoundationDiagnostics): void => {
  text('#errorCode', errorField(diagnostics.lastError, 'code'));
  text('#errorPhase', errorField(diagnostics.lastError, 'phase'));
  text('#errorTick', diagnostics.simulationTick.toString());
};

const setTelemetry = (diagnostics: FoundationDiagnostics): void => {
  const renderer = diagnostics.renderer;
  telemetry.dataset.tesseraSimulationTick = diagnostics.simulationTick.toString();
  telemetry.dataset.tesseraRenderTick = diagnostics.lastRenderTick.toString();
  telemetry.dataset.tesseraSnapshotGeneration = diagnostics.lastSnapshotGeneration.toString();
  telemetry.dataset.tesseraRenderEntityCount = String(diagnostics.lastEntityCount);
  telemetry.dataset.tesseraVisibleEntityCount = String(rendererCount(renderer.visibleEntityCount));
  telemetry.dataset.tesseraOccupiedCellCount = String(rendererCount(renderer.occupiedCellCount));
  telemetry.dataset.tesseraStaleMappingCount = String(rendererCount(renderer.staleMappingCount));
  telemetry.dataset.tesseraEventSequence =
    diagnostics.eventStream.highestContiguousSequence.toString();
  telemetry.dataset.tesseraEventDesynced = String(diagnostics.eventStream.desynced);
  if (diagnostics.lastStateHashHex !== undefined) {
    telemetry.dataset.tesseraStateHash = diagnostics.lastStateHashHex;
  }
  telemetry.textContent = `sim ${diagnostics.simulationTick} · render ${diagnostics.lastRenderTick} · generation ${renderer.lastWorldGeneration}`;
};

const setDiagnostics = (
  runtime: FoundationRuntime,
  pointerCell?: { readonly x: number; readonly z: number },
): FoundationDiagnostics => {
  const diagnostics = runtime.diagnostics();
  setCameraReadouts(runtime, pointerCell);
  setRendererReadouts(runtime, diagnostics);
  setSimulationReadouts(diagnostics);
  setBoundaryMetricReadouts(diagnostics.metrics);
  setMuseumAndLifecycleReadouts(diagnostics);
  setErrorReadouts(diagnostics);
  setTelemetry(diagnostics);
  if (diagnostics.state === 'fatal') {
    setStatus('fatal', { errorCode: diagnostics.lastError?.code ?? 'runtime_fatal' });
  }
  return diagnostics;
};

const setMetricSnapshot = (metrics: FoundationDiagnostics['metrics']): void => {
  setBoundaryMetricReadouts(metrics);
  if (metrics === undefined) {
    result('#boundaryResult', 'Worker metrics are not available yet.', 'danger');
  }
};

try {
  const runtime = createFoundationRuntime({
    canvas,
    seed: SEED.slice(),
    scenario: SCENARIO,
    objectTypes: OBJECT_TYPES,
  });
  let unregisterTestBridge: () => void = () => {
    // Production builds do not register the development facade.
  };
  if (import.meta.env.DEV) {
    unregisterTestBridge = registerTesseraTestBridge(runtime, {
      canvas,
      scenario: SCENARIO,
      scenarios: [SCENARIO],
      seedHex: SEED_HEX,
      overlay: { enabled: false },
    });
  }
  const testBridge: TesseraTestBridge | undefined = import.meta.env.DEV
    ? window.tesseraTest
    : undefined;
  const initialSave = runtime.ready.then(() => runtime.save());
  let latestCell: { x: number; z: number } | undefined;
  let latestPreviewKey = '';
  let selectedObjectType = OBJECT_TYPES[0]?.id ?? 'foundation';
  let placementRotation = 0;
  let placementMode = false;
  let savedBytes: Uint8Array | undefined;
  let observedLifecycleCycles = 0;
  let disposed = false;

  const submitPlace = (target: ReturnType<typeof targetAt>): Promise<unknown> =>
    testBridge?.placeObject(target) ?? runtime.placeObject(target);
  const submitRemove = (entityId: string): Promise<unknown> =>
    testBridge?.removeEntity(entityId) ?? runtime.removeEntity(entityId);
  const saveWorld = (): Promise<Uint8Array> => testBridge?.save() ?? runtime.save();
  const loadWorld = (bytes: Uint8Array): Promise<unknown> =>
    testBridge?.load(bytes) ?? runtime.load(bytes);

  const attemptLoad = async (bytes: Uint8Array): Promise<unknown> => {
    try {
      await loadWorld(bytes);
      return undefined;
    } catch (error: unknown) {
      return error;
    }
  };

  const setPointerCell = (cell: { x: number; z: number } | undefined): void => {
    latestCell = cell;
    setCameraReadouts(runtime, cell);
  };

  const validationDisplay = (
    validation: Awaited<ReturnType<FoundationRuntime['validatePlacement']>>,
  ): { readonly state: string; readonly tone: ResultTone } => {
    if (!validation.valid) {
      return {
        state: `blocked · reason ${validation.rejectionCode ?? 'unknown'}`,
        tone: 'danger',
      };
    }
    const cellLabel = validation.occupiedCellCount === 1 ? 'cell' : 'cells';
    return {
      state: `available · ${validation.occupiedCellCount} ${cellLabel}`,
      tone: 'positive',
    };
  };

  const applyPreviewValidation = (
    key: string,
    target: ReturnType<typeof targetAt>,
    validation: Awaited<ReturnType<FoundationRuntime['validatePlacement']>>,
  ): void => {
    if (latestPreviewKey !== key) {
      return;
    }
    const display = validationDisplay(validation);
    text('#placementStatus', display.state);
    result(
      '#placementResult',
      `${target.objectType} at ${target.x},${target.z}, r${target.rotation} · ${display.state}`,
      display.tone,
    );
  };

  const handlePreviewFailure = (key: string, error: unknown): void => {
    if (latestPreviewKey !== key) {
      return;
    }
    text('#placementStatus', 'unavailable');
    result('#placementResult', errorMessage(error), 'danger');
  };

  const updatePlacementPreview = (): void => {
    if (latestCell === undefined) {
      latestPreviewKey = '';
      runtime.clearPlacementPreview();
      text('#placementStatus', 'move over a cell');
      result('#placementResult', 'Move over a cell to ask Rust for a placement result.');
      return;
    }
    const target = targetAt(selectedObjectType, latestCell, placementRotation);
    const key = `${target.objectType}:${target.x}:${target.z}:${target.rotation}`;
    if (key === latestPreviewKey) {
      return;
    }
    latestPreviewKey = key;
    text('#placementStatus', 'checking…');
    void runtime
      .previewPlacement(target)
      .then((validation) => applyPreviewValidation(key, target, validation))
      .catch((error: unknown) => handlePreviewFailure(key, error));
  };

  const resetWorld = async (resume = true): Promise<void> => {
    if (testBridge !== undefined) {
      await testBridge.reset();
      if (resume) {
        testBridge.resume();
      }
      return;
    }
    await loadWorld(await initialSave);
  };

  const runEntityStress = async (): Promise<void> => {
    const count = Number(required<HTMLSelectElement>('#entityStressCount').value);
    result('#stressResult', `Resetting and placing ${count} deterministic entities…`, 'info');
    await resetWorld(false);
    const types = ['foundation', 'warehouse', 'watchtower'] as const;
    for (let index = 0; index < count; index += 1) {
      const type = types[index % types.length] ?? 'foundation';
      const cell = gridForIndex(index);
      await submitPlace(targetAt(type, cell, index % 4));
    }
    if (testBridge !== undefined) {
      testBridge.resume();
    }
    result(
      '#stressResult',
      `${count} entities submitted · grouped renderer projection updated`,
      'positive',
    );
  };

  const clearEntityStress = async (): Promise<void> => {
    await resetWorld(true);
    result('#stressResult', 'World reset; renderer mappings should now be empty.', 'positive');
  };

  const runSimulationStress = async (): Promise<void> => {
    const target = Number(required<HTMLSelectElement>('#simulationTickCount').value);
    testBridge?.pause();
    text('#simulationClock', testBridge?.isPaused() === true ? 'paused' : 'exact mode');
    result('#simulationResult', `Advancing ${target} ticks in batches of five…`, 'info');
    let remaining = target;
    while (remaining > 0) {
      const batch = Math.min(5, remaining);
      if (testBridge === undefined) {
        await runtime.step(batch);
      } else {
        await testBridge.step(batch);
      }
      remaining -= batch;
    }
    const diagnostics = setDiagnostics(runtime, latestCell);
    text('#simulationClock', clockLabel(testBridge));
    result(
      '#simulationResult',
      `Checkpoint tick ${diagnostics.simulationTick} · ${formatHash(diagnostics.lastStateHashHex)}`,
      'positive',
    );
  };

  const refreshBoundary = async (): Promise<void> => {
    const metrics = await runtime.requestMetrics();
    setMetricSnapshot(metrics);
    result(
      '#boundaryResult',
      `memory generation ${metrics.memoryGeneration} · ${metrics.viewRecreations} view recreations · ${metrics.droppedRenderSnapshots} visual snapshots dropped`,
      'info',
    );
  };

  const stepBoundary = async (): Promise<void> => {
    testBridge?.pause();
    const command = testBridge?.step(1) ?? runtime.step(1);
    await command;
    await refreshBoundary();
    result(
      '#boundaryResult',
      'One exact tick completed; only the render projection may be skipped under backpressure.',
      'positive',
    );
  };

  const saveCurrentWorld = async (): Promise<void> => {
    savedBytes = await saveWorld();
    const diagnostics = setDiagnostics(runtime, latestCell);
    text('#saveBytes', formatBytes(savedBytes.byteLength));
    text('#saveHash', formatHash(diagnostics.lastStateHashHex));
    result(
      '#persistenceResult',
      `Saved ${formatBytes(savedBytes.byteLength)} at tick ${diagnostics.simulationTick}.`,
      'positive',
    );
  };

  const restoreSavedWorld = async (): Promise<void> => {
    if (savedBytes === undefined) {
      result('#persistenceResult', 'Create a save before restoring it.', 'danger');
      return;
    }
    const loaded = await loadWorld(savedBytes);
    const loadResult = loaded as {
      readonly tick: bigint;
      readonly stateHashHex: string;
      readonly worldGeneration: number;
    };
    text('#saveWorldGeneration', String(loadResult.worldGeneration));
    result(
      '#persistenceResult',
      `Restored tick ${loadResult.tick} · ${formatHash(loadResult.stateHashHex)} · world ${loadResult.worldGeneration}.`,
      'positive',
    );
  };

  const reportCorruptImport = (before: FoundationDiagnostics, loadError: unknown): void => {
    if (loadError === undefined) {
      result('#persistenceResult', 'Unexpectedly accepted the corrupted save.', 'danger');
      return;
    }
    const preserved = worldWasPreserved(before, runtime.diagnostics());
    result(
      '#persistenceResult',
      `${errorParts(loadError).code} · active world preserved: ${preserved ? 'yes' : 'no'}`,
      preserved ? 'positive' : 'danger',
    );
  };

  const corruptSavedWorld = async (): Promise<void> => {
    if (savedBytes === undefined) {
      result('#persistenceResult', 'Create a save before testing a corrupt import.', 'danger');
      return;
    }
    const before = runtime.diagnostics();
    reportCorruptImport(before, await attemptLoad(corruptedSave(savedBytes)));
  };

  const loadMuseumScene = async (): Promise<void> => {
    result(
      '#museumResult',
      'Resetting to the canonical seed and loading the fixed museum scene…',
      'info',
    );
    await resetWorld(true);
    runtime.camera.setState({ targetMm: { xMm: 0, yMm: 0, zMm: 0 }, rotation: 0, zoomTiles: 14 });
    const scene = [
      targetAt('foundation', { x: -5, z: -2 }, 0),
      targetAt('warehouse', { x: -1, z: -2 }, 1),
      targetAt('watchtower', { x: 5, z: -2 }, 2),
      targetAt('warehouse', { x: -1, z: 4 }, 3),
    ];
    for (const target of scene) {
      await submitPlace(target);
    }
    if (testBridge !== undefined) {
      testBridge.resume();
    }
    result(
      '#museumResult',
      `Museum scene ready · seed ${SEED_HEX.slice(0, 12)}… · fixed camera r0 / 14 tiles.`,
      'positive',
    );
  };

  const captureReproduction = (): void => {
    if (testBridge === undefined) {
      result(
        '#museumResult',
        'Reproduction manifests are available in development builds only.',
        'danger',
      );
      return;
    }
    const manifest = testBridge.captureReproductionBundle();
    downloadReproductionManifest(manifest, 'tessera-scenario-lab-reproduction.json');
    result(
      '#museumResult',
      `Downloaded ${manifest.format} · ${manifest.commands.length} recorded commands.`,
      'positive',
    );
  };

  const toggleOverlay = (): void => {
    if (testBridge === undefined) {
      result(
        '#museumResult',
        'Annotated overlays are available in development builds only.',
        'danger',
      );
      overlayEnabled.checked = false;
      return;
    }
    testBridge.overlay.setOptions({ enabled: overlayEnabled.checked });
    result(
      '#museumResult',
      overlayEnabled.checked ? 'Annotated overlay enabled.' : 'Annotated overlay hidden.',
      'info',
    );
  };

  const stepGuardProbe = (): Promise<unknown> => {
    testBridge?.resume();
    return testBridge?.step(1) ?? runtime.step(6);
  };

  const errorProbeOperations: Readonly<Record<ErrorProbeKind, () => Promise<unknown>>> = {
    'invalid-placement': () =>
      runtime.validatePlacement(targetAt('missing-object-type', { x: 0, z: 0 })),
    'unknown-entity': () => submitRemove('999:1'),
    'step-guard': stepGuardProbe,
  };

  const reportErrorProbeFailure = (before: FoundationDiagnostics, error: unknown): void => {
    const parts = errorParts(error);
    const after = runtime.diagnostics();
    const preserved = worldWasPreserved(before, after);
    text('#errorCode', parts.code);
    text('#errorPhase', parts.phase);
    text('#errorTick', after.simulationTick.toString());
    text('#errorPreserved', preserved ? 'yes' : 'no');
    result(
      '#errorResult',
      `${parts.code} · ${parts.message} · active world preserved: ${preserved ? 'yes' : 'no'}`,
      preserved ? 'positive' : 'danger',
    );
  };

  const runErrorProbe = async (kind: ErrorProbeKind): Promise<void> => {
    const before = runtime.diagnostics();
    try {
      await errorProbeOperations[kind]();
      result('#errorResult', 'Probe unexpectedly completed without a rejection.', 'danger');
    } catch (error: unknown) {
      reportErrorProbeFailure(before, error);
    }
  };

  const resetLifecycle = async (): Promise<void> => {
    await resetWorld(true);
    observedLifecycleCycles += 1;
    text('#lifecycleCyclesObserved', String(observedLifecycleCycles));
    const diagnostics = setDiagnostics(runtime, latestCell);
    text('#lifecycleBridge', testBridge === undefined ? 'production-disabled' : 'available');
    result(
      '#lifecycleResult',
      `Reset ${observedLifecycleCycles} time(s) · world generation ${diagnostics.renderer.lastWorldGeneration}.`,
      'positive',
    );
  };

  const runLifecycle = async (): Promise<void> => {
    const cycles = Number(required<HTMLSelectElement>('#lifecycleCycles').value);
    result('#lifecycleResult', `Running ${cycles} reset cycles…`, 'info');
    for (let index = 0; index < cycles; index += 1) {
      await resetLifecycle();
    }
    result(
      '#lifecycleResult',
      `${cycles} reset cycles complete; inspect stale mappings and world generation above.`,
      'positive',
    );
  };

  const runAsync = (operation: () => Promise<void>, failureTarget: string): void => {
    void operation().catch((error: unknown) => {
      const parts = errorParts(error);
      result(failureTarget, `${parts.code} · ${parts.message}`, 'danger');
      setStatus('error', { errorCode: parts.code, errorMessage: parts.message });
    });
  };

  const setPlacementMode = (enabled: boolean): void => {
    placementMode = enabled;
    placementButton.setAttribute('aria-pressed', String(enabled));
    placementButton.textContent = enabled ? 'Cancel placement' : 'Place mode';
    result(
      '#placementResult',
      enabled ? 'Placement mode on · click a grid cell to place.' : 'Placement mode cancelled.',
      'info',
    );
  };

  const rotatePlacementLeft = (): void => {
    placementRotation = (placementRotation + 3) % 4;
    text('#placementRotation', `r${placementRotation}`);
    updatePlacementPreview();
  };

  const rotatePlacementRight = (): void => {
    placementRotation = (placementRotation + 1) % 4;
    text('#placementRotation', `r${placementRotation}`);
    updatePlacementPreview();
  };

  const togglePlacementMode = (): void => {
    setPlacementMode(!placementMode);
  };

  const removeSelected = (): void => {
    const entityId = runtime.selectedEntity();
    if (entityId === undefined) {
      result('#placementResult', 'Select an entity before removing it.', 'danger');
      return;
    }
    runAsync(async () => {
      await submitRemove(entityId);
      result('#placementResult', `Removal submitted for ${entityId}.`, 'positive');
    }, '#placementResult');
  };

  const placementActions: Readonly<Record<string, () => void>> = {
    'rotate-left': rotatePlacementLeft,
    'rotate-right': rotatePlacementRight,
    place: togglePlacementMode,
    remove: removeSelected,
  };

  const actionLayer = new CameraActionLayer({
    canvas,
    camera: runtime.camera,
    viewport: () => viewportForCanvas(canvas),
  });
  actionLayer.attach();
  const selectionLayer = new SelectionActionLayer({
    canvas,
    onPrimaryClick: (point) => {
      if (!placementMode) {
        runtime.pick(point);
      }
    },
  });
  selectionLayer.attach();

  const disposers: Array<() => void> = [];
  const addClick = (button: HTMLButtonElement, listener: () => void): void => {
    const handler = (): void => listener();
    button.addEventListener('click', handler);
    disposers.push(() => button.removeEventListener('click', handler));
  };
  const addChange = <T extends HTMLInputElement | HTMLSelectElement>(
    control: T,
    listener: () => void,
  ): void => {
    const handler = (): void => listener();
    control.addEventListener('change', handler);
    disposers.push(() => control.removeEventListener('change', handler));
  };

  const cancelPlacementForLab = (id: LabId): void => {
    if (!placementMode || id === 'placement') {
      return;
    }
    setPlacementMode(false);
  };

  const selectLab = (rawId: string | undefined): void => {
    if (rawId === undefined) {
      return;
    }
    if (!isLabId(rawId)) {
      return;
    }
    cancelPlacementForLab(rawId);
    setActiveLab(rawId);
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lab-tab]')) {
    addClick(button, () => selectLab(button.dataset.labTab));
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera-action]')) {
    addClick(button, () => {
      const action = button.dataset.cameraAction;
      if (action === 'rotate-left') {
        runtime.camera.rotateCounterClockwise();
      } else if (action === 'rotate-right') {
        runtime.camera.rotateClockwise();
      } else if (action === 'focus-origin') {
        runtime.camera.focusGrid({ x: 0, z: 0 }, 0);
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-placement-action]')) {
    addClick(button, () => {
      const action = button.dataset.placementAction;
      if (action !== undefined) {
        placementActions[action]?.();
      }
    });
  }

  addChange(placementObjectType, () => {
    selectedObjectType = placementObjectType.value;
    setPlacementDefinitionReadout(selectedObjectType);
    updatePlacementPreview();
  });
  addChange(overlayEnabled, toggleOverlay);

  const pauseSimulation = (): void => {
    testBridge?.pause();
    text('#simulationClock', testBridge?.isPaused() === true ? 'paused' : 'exact mode');
    result('#simulationResult', 'Exact stepping is armed.', 'info');
  };

  const resumeSimulation = (): void => {
    testBridge?.resume();
    text('#simulationClock', 'running');
    result('#simulationResult', 'Development clock gate released.', 'positive');
  };

  const simulationActions: Readonly<Record<string, () => void>> = {
    pause: pauseSimulation,
    resume: resumeSimulation,
    run: () => runAsync(runSimulationStress, '#simulationResult'),
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-stress-action]')) {
    addClick(button, () => {
      const action = button.dataset.stressAction;
      if (action === 'entities') {
        runAsync(runEntityStress, '#stressResult');
      } else if (action === 'clear') {
        runAsync(clearEntityStress, '#stressResult');
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-simulation-action]')) {
    addClick(button, () => {
      const action = button.dataset.simulationAction;
      if (action !== undefined) {
        simulationActions[action]?.();
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-boundary-action]')) {
    addClick(button, () => {
      const action = button.dataset.boundaryAction;
      if (action === 'refresh') {
        runAsync(refreshBoundary, '#boundaryResult');
      } else if (action === 'step') {
        runAsync(stepBoundary, '#boundaryResult');
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-persistence-action]')) {
    addClick(button, () => {
      const action = button.dataset.persistenceAction;
      if (action === 'save') {
        runAsync(saveCurrentWorld, '#persistenceResult');
      } else if (action === 'load') {
        runAsync(restoreSavedWorld, '#persistenceResult');
      } else if (action === 'corrupt') {
        runAsync(corruptSavedWorld, '#persistenceResult');
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-museum-action]')) {
    addClick(button, () => {
      const action = button.dataset.museumAction;
      if (action === 'scene') {
        runAsync(loadMuseumScene, '#museumResult');
      } else if (action === 'reset') {
        runAsync(resetLifecycle, '#museumResult');
      } else if (action === 'capture') {
        captureReproduction();
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-error-action]')) {
    addClick(button, () => {
      const action = button.dataset.errorAction;
      if (
        action === 'invalid-placement' ||
        action === 'unknown-entity' ||
        action === 'step-guard'
      ) {
        runAsync(() => runErrorProbe(action), '#errorResult');
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lifecycle-action]')) {
    addClick(button, () => {
      const action = button.dataset.lifecycleAction;
      if (action === 'run') {
        runAsync(runLifecycle, '#lifecycleResult');
      } else if (action === 'reset') {
        runAsync(resetLifecycle, '#lifecycleResult');
      }
    });
  }

  const pointerMove = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    const cell = runtime.camera.screenToGrid(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewportForCanvas(canvas),
      0,
    );
    setPointerCell(cell);
    updatePlacementPreview();
  };
  const pointerLeave = (): void => {
    setPointerCell(undefined);
    updatePlacementPreview();
  };
  const placementClick = (event: MouseEvent): void => {
    if (!placementMode || event.button !== 0) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const cell = runtime.camera.screenToGrid(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewportForCanvas(canvas),
      0,
    );
    if (cell === undefined) {
      result('#placementResult', 'Click a valid grid cell to place.', 'danger');
      return;
    }
    setPointerCell(cell);
    const target = targetAt(selectedObjectType, cell, placementRotation);
    runAsync(async () => {
      await submitPlace(target);
      result(
        '#placementResult',
        `Placed ${target.objectType} at ${target.x},${target.z}, r${target.rotation}. Click another cell or cancel placement.`,
        'positive',
      );
    }, '#placementResult');
  };
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('click', placementClick);
  disposers.push(() => canvas.removeEventListener('pointermove', pointerMove));
  disposers.push(() => canvas.removeEventListener('pointerleave', pointerLeave));
  disposers.push(() => canvas.removeEventListener('click', placementClick));

  const unsubscribeDiagnostics = runtime.subscribeDiagnostics((diagnostics) => {
    setDiagnostics(runtime, latestCell);
    setMetricSnapshot(diagnostics.metrics);
    if (diagnostics.state === 'fatal') {
      setStatus('fatal', { errorCode: diagnostics.lastError?.code ?? 'runtime_fatal' });
    }
  });
  const unsubscribeCamera = runtime.camera.subscribe(() => {
    setCameraReadouts(runtime, latestCell);
    updatePlacementPreview();
  });
  const unsubscribeSelection = runtime.subscribeSelection((entityId) => {
    text('#selectedEntity', entityId ?? '—');
    text(
      '#selectionBounds',
      formatBounds(entityId === undefined ? undefined : runtime.screenBounds(entityId)),
    );
    telemetry.dataset.tesseraSelectedEntity = entityId ?? '';
  });
  disposers.push(unsubscribeDiagnostics, unsubscribeCamera, unsubscribeSelection);

  setPlacementDefinitionReadout(selectedObjectType);
  setActiveLab('camera');
  text('#lifecycleBridge', testBridge === undefined ? 'production-disabled' : 'available');

  void runtime.ready
    .then(async (ready) => {
      setStatus('ready', { tick: String(ready.tick) });
      await runtime.save();
      const response = await runtime.placeObject(targetAt('foundation', { x: 0, z: 0 }, 0));
      await runtime.waitForRenderedTick(response.tick);
      setStatus('probe-passed', { tick: String(response.tick), stateHash: response.stateHashHex });
      result(
        '#placementResult',
        'Foundation probe placed at the origin. Move over a cell to continue.',
        'positive',
      );
    })
    .catch((error: unknown) => {
      const parts = errorParts(error);
      setStatus('fatal', { errorCode: parts.code, errorMessage: parts.message });
      result('#placementResult', `${parts.code} · ${parts.message}`, 'danger');
    });

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    unregisterTestBridge();
    for (const removeListener of disposers) {
      removeListener();
    }
    actionLayer.dispose();
    selectionLayer.dispose();
    runtime.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
} catch (error: unknown) {
  const parts = errorParts(error);
  setStatus('fatal', { errorCode: parts.code, errorMessage: parts.message });
}
