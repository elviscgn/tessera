import {
  createFoundationRuntime,
  SelectionActionLayer,
  type FoundationDiagnostics,
  type FoundationRuntime,
  type ScreenBounds,
} from '../../../src/public/index';
import { CameraActionLayer } from '../../../src/input/camera-action-layer';

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas');
const status = document.querySelector<HTMLOutputElement>('#status');
const telemetry = document.querySelector<HTMLElement>('#app');
const cameraRotation = document.querySelector<HTMLElement>('#cameraRotation');
const cameraZoom = document.querySelector<HTMLElement>('#cameraZoom');
const cameraTarget = document.querySelector<HTMLElement>('#cameraTarget');
const pointerCell = document.querySelector<HTMLElement>('#pointerCell');
const occupiedCells = document.querySelector<HTMLElement>('#occupiedCells');
const selectedEntity = document.querySelector<HTMLElement>('#selectedEntity');
const selectionBounds = document.querySelector<HTMLElement>('#selectionBounds');
const placementStatus = document.querySelector<HTMLElement>('#placementStatus');
const placementButtons = document.querySelectorAll<HTMLButtonElement>('[data-placement-action]');
const cameraButtons = document.querySelectorAll<HTMLButtonElement>('[data-camera-action]');

if (
  !canvas ||
  !status ||
  !telemetry ||
  !cameraRotation ||
  !cameraZoom ||
  !cameraTarget ||
  !pointerCell ||
  !occupiedCells ||
  !selectedEntity ||
  !selectionBounds ||
  !placementStatus
) {
  throw new Error('The Scenario Lab foundation mount is missing.');
}

const viewport = (): { width: number; height: number } => {
  const bounds = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width || canvas.clientWidth),
    height: Math.max(1, bounds.height || canvas.clientHeight),
  };
};

const detailDatasetKey = (key: string): string =>
  `tessera${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`;

const setStatusDetails = (details: Record<string, string>): void => {
  for (const [key, detail] of Object.entries(details)) {
    const datasetKey = detailDatasetKey(key);
    status.dataset[datasetKey] = detail;
    telemetry.dataset[datasetKey] = detail;
  }
};

const setStatus = (value: string, details: Record<string, string> = {}): void => {
  status.dataset.tesseraStatus = value;
  telemetry.dataset.tesseraStatus = value;
  setStatusDetails(details);
  const tickSuffix = details.tick === undefined ? '' : ` (tick ${details.tick})`;
  status.textContent = `Tessera ${value}${tickSuffix}`;
};

const setMetricDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  for (const [key, value] of Object.entries(diagnostics.metrics ?? {})) {
    telemetry.dataset[`tesseraMetric${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = String(value);
  }
};

const setEventDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  telemetry.dataset.tesseraEventSequence = String(
    diagnostics.eventStream.highestContiguousSequence,
  );
  telemetry.dataset.tesseraEventDesynced = String(diagnostics.eventStream.desynced);
};

const optionalMetric = (value: number | undefined): string => String(value ?? 0);

const setRenderFrameDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  telemetry.dataset.tesseraSnapshotGeneration = String(diagnostics.lastSnapshotGeneration);
  telemetry.dataset.tesseraRenderTick = String(diagnostics.lastRenderTick);
  telemetry.dataset.tesseraRenderEntityCount = String(diagnostics.lastEntityCount);
  telemetry.dataset.tesseraRenderFrames = String(diagnostics.renderer.renderFrames);
  telemetry.dataset.tesseraRendererSnapshots = String(diagnostics.renderer.receivedSnapshots);
};

const setRenderEntityDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  telemetry.dataset.tesseraOccupiedCellCount = optionalMetric(
    diagnostics.renderer.occupiedCellCount,
  );
  telemetry.dataset.tesseraVisibleEntityCount = optionalMetric(
    diagnostics.renderer.visibleEntityCount,
  );
  telemetry.dataset.tesseraStaleMappingCount = optionalMetric(
    diagnostics.renderer.staleMappingCount,
  );
  occupiedCells.textContent = optionalMetric(diagnostics.renderer.occupiedCellCount);
};

const setRenderDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  setRenderFrameDiagnostics(diagnostics);
  setRenderEntityDiagnostics(diagnostics);
};

const setSynchronizationDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  setEventDiagnostics(diagnostics);
  setRenderDiagnostics(diagnostics);
};

const setOptionalDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  if (diagnostics.lastStateHashHex !== undefined) {
    telemetry.dataset.tesseraStateHash = diagnostics.lastStateHashHex;
  }
  if (diagnostics.lastError !== undefined) {
    telemetry.dataset.tesseraErrorCode = diagnostics.lastError.code;
  }
};

const setDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  setMetricDiagnostics(diagnostics);
  setSynchronizationDiagnostics(diagnostics);
  setOptionalDiagnostics(diagnostics);
};

const setCameraLab = (runtime: FoundationRuntime): void => {
  const state = runtime.camera.state;
  cameraRotation.textContent = `r${state.rotation}`;
  cameraZoom.textContent = `${state.zoomTiles.toFixed(1)} tiles`;
  cameraTarget.textContent = `${Math.round(state.targetMm.xMm)}, ${Math.round(
    state.targetMm.yMm,
  )}, ${Math.round(state.targetMm.zMm)}`;
  telemetry.dataset.tesseraCameraRotation = `r${state.rotation}`;
  telemetry.dataset.tesseraCameraZoomTiles = String(state.zoomTiles);
  telemetry.dataset.tesseraCameraTargetMm = `${state.targetMm.xMm},${state.targetMm.yMm},${state.targetMm.zMm}`;
};

const formatSelectionBounds = (bounds: ScreenBounds | undefined): string => {
  if (bounds === undefined) {
    return '—';
  }
  return `${Math.round(bounds.left)},${Math.round(bounds.top)} ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
};

const setSelectionLab = (runtime: FoundationRuntime, entityId: string | undefined): void => {
  selectedEntity.textContent = entityId ?? '—';
  telemetry.dataset.tesseraSelectedEntity = entityId ?? '';
  selectionBounds.textContent = formatSelectionBounds(
    entityId === undefined ? undefined : runtime.screenBounds(entityId),
  );
};

try {
  const runtime = createFoundationRuntime({
    canvas,
    scenario: { id: 'foundation' },
    objectTypes: [{ id: 'foundation' }],
  });
  const unsubscribe = runtime.subscribeDiagnostics((diagnostics) => {
    setDiagnostics(diagnostics);
    setCameraLab(runtime);
    if (diagnostics.state === 'fatal') {
      setStatus('fatal', { errorCode: diagnostics.lastError?.code ?? 'runtime_fatal' });
    }
  });
  const unsubscribeCamera = runtime.camera.subscribe(() => {
    setCameraLab(runtime);
  });
  const actionLayer = new CameraActionLayer({ canvas, camera: runtime.camera, viewport });
  actionLayer.attach();
  const selectionLayer = new SelectionActionLayer({
    canvas,
    onPrimaryClick: (point) => runtime.pick(point),
  });
  selectionLayer.attach();
  const unsubscribeSelection = runtime.subscribeSelection((entityId) => {
    setSelectionLab(runtime, entityId);
  });

  let latestCell: { x: number; z: number } | undefined;
  let latestPreviewKey = '';

  const setPointerCell = (cell: { x: number; z: number } | undefined): void => {
    pointerCell.textContent = cell === undefined ? '—' : `${cell.x}, ${cell.z}`;
    telemetry.dataset.tesseraPointerCell = cell === undefined ? '' : `${cell.x},${cell.z}`;
  };

  const updatePlacementPreview = (cell: { x: number; z: number } | undefined): void => {
    if (cell === undefined) {
      runtime.clearPlacementPreview();
      placementStatus.textContent = '—';
      return;
    }
    const target = {
      objectType: 'foundation',
      x: cell.x,
      z: cell.z,
      elevationMm: 0,
      rotation: runtime.camera.state.rotation,
    };
    const key = `${target.x}:${target.z}:${target.rotation}`;
    if (key === latestPreviewKey) {
      return;
    }
    latestPreviewKey = key;
    void runtime
      .previewPlacement(target)
      .then((result) => {
        placementStatus.textContent = result.valid
          ? `available · ${result.occupiedCellCount} cell`
          : `blocked · reason ${result.rejectionCode ?? 'unknown'}`;
      })
      .catch(() => {
        placementStatus.textContent = 'preview unavailable';
      });
  };

  const pointerMove = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    const cell = runtime.camera.screenToGrid(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewport(),
      0,
    );
    setPointerCell(cell);
    latestCell = cell;
    updatePlacementPreview(cell);
  };
  const pointerLeave = (): void => {
    latestCell = undefined;
    latestPreviewKey = '';
    setPointerCell(undefined);
    updatePlacementPreview(undefined);
  };
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerleave', pointerLeave);

  const buttonListeners: Array<{
    readonly button: HTMLButtonElement;
    readonly listener: () => void;
  }> = [];
  for (const button of cameraButtons) {
    const action = button.dataset.cameraAction;
    const listener = (): void => {
      if (action === 'rotate-left') {
        runtime.camera.rotateCounterClockwise();
      } else if (action === 'rotate-right') {
        runtime.camera.rotateClockwise();
      } else if (action === 'focus-origin') {
        runtime.camera.focusGrid({ x: 0, z: 0 }, 0);
      }
    };
    button.addEventListener('click', listener);
    buttonListeners.push({ button, listener });
  }

  const placementButtonListeners: Array<{
    readonly button: HTMLButtonElement;
    readonly listener: () => void;
  }> = [];
  const placeAtPointer = (): void => {
    if (latestCell === undefined) {
      return;
    }
    void runtime
      .placeObject({
        objectType: 'foundation',
        x: latestCell.x,
        z: latestCell.z,
        elevationMm: 0,
        rotation: runtime.camera.state.rotation,
      })
      .then(() => {
        placementStatus.textContent = 'placed';
      })
      .catch(() => {
        placementStatus.textContent = 'placement rejected';
      });
  };
  const removeSelected = (): void => {
    const entityId = runtime.selectedEntity();
    if (entityId === undefined) {
      return;
    }
    void runtime
      .removeEntity(entityId)
      .then(() => {
        placementStatus.textContent = 'removal submitted';
      })
      .catch(() => {
        placementStatus.textContent = 'removal rejected';
      });
  };
  const placementActions: Record<string, () => void> = {
    place: placeAtPointer,
    remove: removeSelected,
  };
  const refreshPlacementPreview = (): void => {
    if (latestCell !== undefined) {
      updatePlacementPreview(latestCell);
    }
  };
  const unsubscribePlacementCamera = runtime.camera.subscribe(refreshPlacementPreview);
  for (const button of placementButtons) {
    const action = button.dataset.placementAction;
    const listener = (): void => placementActions[action ?? '']?.();
    button.addEventListener('click', listener);
    placementButtonListeners.push({ button, listener });
  }

  void runtime.ready
    .then(async (ready) => {
      setStatus('ready', { tick: String(ready.tick) });
      const response = await runtime.placeObject({
        objectType: 'foundation',
        x: 0,
        z: 0,
        elevationMm: 0,
        rotation: 0,
      });
      setStatus('probe-passed', {
        tick: String(response.tick),
        stateHash: response.stateHashHex,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('fatal', { errorCode: 'runtime_startup', errorMessage: message });
    });

  const dispose = (): void => {
    unsubscribe();
    unsubscribeCamera();
    unsubscribeSelection();
    unsubscribePlacementCamera();
    actionLayer.dispose();
    selectionLayer.dispose();
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerleave', pointerLeave);
    for (const { button, listener } of buttonListeners) {
      button.removeEventListener('click', listener);
    }
    for (const { button, listener } of placementButtonListeners) {
      button.removeEventListener('click', listener);
    }
    runtime.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus('fatal', { errorCode: 'renderer_startup', errorMessage: message });
}
