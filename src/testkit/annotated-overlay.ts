import type { FoundationDiagnostics, FoundationRuntime } from '../browser/foundation-runtime';
import { viewportForCanvas } from '../browser/canvas-viewport';
import type { CameraState, CameraViewport } from '../renderer/isometric-camera';
import { formatEntityId, type ScreenBounds } from '../renderer/entity-selection';
import type { RenderEntityRecord, RenderGridCell } from '../worker/data-protocol';

export interface AnnotatedOverlayOptions {
  readonly enabled?: boolean;
  readonly showEntityIds?: boolean;
  readonly showGridPositions?: boolean;
  readonly showOccupiedCells?: boolean;
  readonly showSelectionBounds?: boolean;
  readonly showCamera?: boolean;
  readonly showDiagnostics?: boolean;
}

export interface NormalizedAnnotatedOverlayOptions {
  readonly enabled: boolean;
  readonly showEntityIds: boolean;
  readonly showGridPositions: boolean;
  readonly showOccupiedCells: boolean;
  readonly showSelectionBounds: boolean;
  readonly showCamera: boolean;
  readonly showDiagnostics: boolean;
}

export interface AnnotatedEntity {
  readonly id: string;
  readonly slot: number;
  readonly generation: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly visualType: number;
  readonly renderFlags: number;
  readonly bounds?: ScreenBounds;
}

export interface AnnotatedOverlayCapture {
  readonly options: NormalizedAnnotatedOverlayOptions;
  readonly camera: CameraState;
  readonly viewport: CameraViewport;
  readonly state: FoundationDiagnostics['state'];
  readonly simulationTick: string;
  readonly renderedTick: string;
  readonly renderGeneration: string;
  readonly worldGeneration: number;
  readonly entityCount: number;
  readonly occupiedCellCount: number;
  readonly selectedEntityId?: string;
  readonly eventSequence: string;
  readonly eventDesynced: boolean;
  readonly stateHashHex?: string;
  readonly entities: readonly AnnotatedEntity[];
  readonly occupiedCells: readonly RenderGridCell[];
}

export interface AnnotatedOverlayCaptureInput {
  readonly options: NormalizedAnnotatedOverlayOptions;
  readonly camera: CameraState;
  readonly viewport: CameraViewport;
  readonly diagnostics: FoundationDiagnostics;
  readonly entities: readonly RenderEntityRecord[];
  readonly occupiedCells: readonly RenderGridCell[];
  readonly boundsForEntity?: (entityId: string) => ScreenBounds | undefined;
}

const defaults: NormalizedAnnotatedOverlayOptions = {
  enabled: false,
  showEntityIds: true,
  showGridPositions: true,
  showOccupiedCells: true,
  showSelectionBounds: true,
  showCamera: true,
  showDiagnostics: true,
};

export const normalizeAnnotatedOverlayOptions = (
  options: AnnotatedOverlayOptions = {},
): NormalizedAnnotatedOverlayOptions => ({
  enabled: options.enabled ?? defaults.enabled,
  showEntityIds: options.showEntityIds ?? defaults.showEntityIds,
  showGridPositions: options.showGridPositions ?? defaults.showGridPositions,
  showOccupiedCells: options.showOccupiedCells ?? defaults.showOccupiedCells,
  showSelectionBounds: options.showSelectionBounds ?? defaults.showSelectionBounds,
  showCamera: options.showCamera ?? defaults.showCamera,
  showDiagnostics: options.showDiagnostics ?? defaults.showDiagnostics,
});

/** Builds a deterministic, serializable overlay capture without touching Babylon. */
export const buildAnnotatedOverlayCapture = (
  input: AnnotatedOverlayCaptureInput,
): AnnotatedOverlayCapture => ({
  options: { ...input.options },
  camera: {
    targetMm: { ...input.camera.targetMm },
    rotation: input.camera.rotation,
    zoomTiles: input.camera.zoomTiles,
  },
  viewport: { ...input.viewport },
  state: input.diagnostics.state,
  simulationTick: input.diagnostics.simulationTick.toString(),
  renderedTick: input.diagnostics.lastRenderTick.toString(),
  renderGeneration: input.diagnostics.lastSnapshotGeneration.toString(),
  worldGeneration: input.diagnostics.renderer.lastWorldGeneration,
  entityCount: input.diagnostics.lastEntityCount,
  occupiedCellCount: input.occupiedCells.length,
  ...(input.diagnostics.selectedEntityId === undefined
    ? {}
    : { selectedEntityId: input.diagnostics.selectedEntityId }),
  eventSequence: input.diagnostics.eventStream.highestContiguousSequence.toString(),
  eventDesynced: input.diagnostics.eventStream.desynced,
  ...(input.diagnostics.lastStateHashHex === undefined
    ? {}
    : { stateHashHex: input.diagnostics.lastStateHashHex }),
  entities: input.entities.map((entity) => {
    const id = formatEntityId({ slot: entity.slot, generation: entity.generation });
    const bounds = input.boundsForEntity?.(id);
    return {
      id,
      slot: entity.slot,
      generation: entity.generation,
      x: entity.x,
      z: entity.z,
      elevationMm: entity.elevationMm,
      visualType: entity.visualType,
      renderFlags: entity.renderFlags,
      ...(bounds === undefined ? {} : { bounds: { ...bounds } }),
    };
  }),
  occupiedCells: input.occupiedCells.map((cell) => ({ ...cell })),
});

export interface AnnotatedOverlayController {
  readonly options: NormalizedAnnotatedOverlayOptions;
  setOptions(options: AnnotatedOverlayOptions): NormalizedAnnotatedOverlayOptions;
  capture(): AnnotatedOverlayCapture;
  dispose(): void;
}

const overlaySummaryLines = (capture: AnnotatedOverlayCapture): readonly string[] => {
  const lines: string[] = [];
  if (capture.options.showDiagnostics) {
    lines.push(
      `state=${capture.state} sim=${capture.simulationTick} render=${capture.renderedTick} generation=${capture.renderGeneration}`,
    );
  }
  if (capture.options.showCamera) {
    lines.push(
      `camera=r${capture.camera.rotation} zoom=${capture.camera.zoomTiles.toFixed(2)} target=${Math.round(capture.camera.targetMm.xMm)},${Math.round(capture.camera.targetMm.yMm)},${Math.round(capture.camera.targetMm.zMm)}`,
    );
  }
  if (capture.options.showOccupiedCells) {
    lines.push(`occupied=${capture.occupiedCellCount}`);
  }
  return lines;
};

const entityLabelText = (capture: AnnotatedOverlayCapture, entity: AnnotatedEntity): string =>
  [
    capture.options.showEntityIds ? entity.id : '',
    capture.options.showGridPositions ? `(${entity.x},${entity.z})` : '',
  ]
    .filter(Boolean)
    .join(' ');

const appendEntityLabels = (root: HTMLDivElement, capture: AnnotatedOverlayCapture): void => {
  if (!capture.options.showEntityIds && !capture.options.showGridPositions) {
    return;
  }
  for (const entity of capture.entities) {
    const label = document.createElement('span');
    label.dataset.tesseraEntityId = entity.id;
    label.style.position = 'absolute';
    label.style.left = `${Math.round(entity.bounds?.left ?? 8)}px`;
    label.style.top = `${Math.round(entity.bounds?.top ?? 32)}px`;
    label.textContent = entityLabelText(capture, entity);
    root.append(label);
  }
};

/**
 * Creates a development-only DOM overlay. It is an observer: all values come
 * from validated runtime snapshots and presentation state, never from DOM
 * input or an authoritative mutation path.
 */
export const createAnnotatedOverlay = (
  runtime: FoundationRuntime,
  canvas: HTMLCanvasElement,
  initialOptions: AnnotatedOverlayOptions = {},
): AnnotatedOverlayController => {
  const parent = canvas.parentElement;
  if (parent === null) {
    throw new Error('tessera:testkit:overlay_parent:canvas must have a parent element');
  }
  let currentOptions = normalizeAnnotatedOverlayOptions(initialOptions);
  const root = document.createElement('div');
  root.dataset.tesseraTestOverlay = 'true';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';
  root.style.font = '12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace';
  root.style.color = '#f8fafc';
  root.style.textShadow = '0 1px 2px #000';
  parent.append(root);

  let frame: number | undefined;
  let disposed = false;

  const capture = (): AnnotatedOverlayCapture => {
    const inspection = runtime.renderInspection();
    return buildAnnotatedOverlayCapture({
      options: currentOptions,
      camera: runtime.camera.state,
      viewport: viewportForCanvas(canvas),
      diagnostics: runtime.diagnostics(),
      entities: inspection.entities,
      occupiedCells: inspection.occupiedCells,
      boundsForEntity: (entityId) => runtime.screenBounds(entityId),
    });
  };

  const render = (): void => {
    frame = undefined;
    if (disposed) {
      return;
    }
    root.replaceChildren();
    root.style.display = currentOptions.enabled ? 'block' : 'none';
    if (!currentOptions.enabled) {
      return;
    }
    const snapshot = capture();
    const summary = document.createElement('pre');
    summary.style.margin = '8px';
    summary.style.whiteSpace = 'pre-wrap';
    summary.textContent = overlaySummaryLines(snapshot).join('\n');
    root.append(summary);
    appendEntityLabels(root, snapshot);
  };

  const schedule = (): void => {
    if (frame !== undefined || disposed) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      frame = globalThis.requestAnimationFrame(render);
    } else {
      frame = Number(globalThis.setTimeout(render, 0));
    }
  };

  const unsubscribeDiagnostics = runtime.subscribeDiagnostics(schedule);
  const unsubscribeCamera = runtime.camera.subscribe(schedule);
  render();

  return {
    get options(): NormalizedAnnotatedOverlayOptions {
      return { ...currentOptions };
    },
    setOptions(options): NormalizedAnnotatedOverlayOptions {
      currentOptions = normalizeAnnotatedOverlayOptions(options);
      schedule();
      return { ...currentOptions };
    },
    capture,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeDiagnostics();
      unsubscribeCamera();
      if (frame !== undefined) {
        if (typeof globalThis.cancelAnimationFrame === 'function') {
          globalThis.cancelAnimationFrame(frame);
        } else {
          globalThis.clearTimeout(frame);
        }
      }
      root.remove();
    },
  };
};
