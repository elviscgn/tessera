import {
  createFoundationRuntime,
  type FoundationDiagnostics,
  type FoundationRuntime,
} from '../../../src/public/index';
import { CameraActionLayer } from '../../../src/input/camera-action-layer';
import { encodeSpawnCommandBatch } from '../../../src/worker/bridge-protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas');
const status = document.querySelector<HTMLOutputElement>('#status');
const telemetry = document.querySelector<HTMLElement>('#app');
const cameraRotation = document.querySelector<HTMLElement>('#cameraRotation');
const cameraZoom = document.querySelector<HTMLElement>('#cameraZoom');
const cameraTarget = document.querySelector<HTMLElement>('#cameraTarget');
const pointerCell = document.querySelector<HTMLElement>('#pointerCell');
const cameraButtons = document.querySelectorAll<HTMLButtonElement>('[data-camera-action]');

if (
  !canvas ||
  !status ||
  !telemetry ||
  !cameraRotation ||
  !cameraZoom ||
  !cameraTarget ||
  !pointerCell
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

const setSynchronizationDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  telemetry.dataset.tesseraEventSequence = String(
    diagnostics.eventStream.highestContiguousSequence,
  );
  telemetry.dataset.tesseraEventDesynced = String(diagnostics.eventStream.desynced);
  telemetry.dataset.tesseraSnapshotGeneration = String(diagnostics.lastSnapshotGeneration);
  telemetry.dataset.tesseraRenderTick = String(diagnostics.lastRenderTick);
  telemetry.dataset.tesseraRenderEntityCount = String(diagnostics.lastEntityCount);
  telemetry.dataset.tesseraRenderFrames = String(diagnostics.renderer.renderFrames);
  telemetry.dataset.tesseraRendererSnapshots = String(diagnostics.renderer.receivedSnapshots);
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

try {
  const runtime = createFoundationRuntime({ canvas });
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

  const pointerMove = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    const cell = runtime.camera.screenToGrid(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewport(),
      0,
    );
    pointerCell.textContent = cell === undefined ? '—' : `${cell.x}, ${cell.z}`;
    telemetry.dataset.tesseraPointerCell = cell === undefined ? '' : `${cell.x},${cell.z}`;
  };
  const pointerLeave = (): void => {
    pointerCell.textContent = '—';
    telemetry.dataset.tesseraPointerCell = '';
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

  void runtime.ready
    .then(async (ready) => {
      setStatus('ready', { tick: String(ready.tick) });
      const command = encodeSpawnCommandBatch({
        batchSequence: 1n,
        clientSequence: 1n,
        objectType: 1,
        x: 0,
        z: 0,
        elevationMm: 0,
        rotation: 0,
      });
      const response = await runtime.submitCommand(command, 1);
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
    actionLayer.dispose();
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerleave', pointerLeave);
    for (const { button, listener } of buttonListeners) {
      button.removeEventListener('click', listener);
    }
    runtime.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus('fatal', { errorCode: 'renderer_startup', errorMessage: message });
}
