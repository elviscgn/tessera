import { describe, expect, it } from 'vitest';
import {
  CameraActionLayer,
  CameraProjection,
  DEFAULT_CAMERA_PITCH_RADIANS,
  DEFAULT_CAMERA_ZOOM_TILES,
  DEFAULT_TILE_SIZE_MM,
  FoundationRuntime,
  MAX_CAMERA_ZOOM_TILES,
  MIN_CAMERA_ZOOM_TILES,
  SelectionActionLayer,
  viewportForCanvas,
  boundsFromPoints,
  formatEntityId,
  parseEntityId,
  createFoundationRuntime,
} from '../../src/public/index';
import type {
  CameraPointMm,
  CameraPose,
  CameraProjectionOptions,
  CameraRotation,
  CameraScreenPoint,
  CameraState,
  CameraVector,
  CameraViewport,
  EntityTransformTarget,
  FoundationDiagnostics,
  FoundationError,
  FoundationReady,
  FoundationRenderer,
  FoundationRenderInspection,
  FoundationRuntimeOptions,
  FoundationState,
  FoundationWorker,
  GridCoordinate,
  OrthographicBoundsMm,
  ObjectTypeDefinition,
  PlacementPreview,
  PlacementTarget,
  PlacementValidation,
  ScenarioDefinition,
  EntityId,
  EntityHandle,
  ScreenBounds,
  ScreenPoint,
  SelectionActionLayerOptions,
} from '../../src/public/index';

describe('public runtime surface', () => {
  it('keeps the documented camera and lifecycle exports reachable', () => {
    const cameraOptions: CameraProjectionOptions = {
      tileSizeMm: DEFAULT_TILE_SIZE_MM,
      zoomTiles: DEFAULT_CAMERA_ZOOM_TILES,
      pitchRadians: DEFAULT_CAMERA_PITCH_RADIANS,
    };
    const camera = new CameraProjection(cameraOptions);
    const state: CameraState = camera.state;
    const point: CameraPointMm = camera.gridToWorldCenter({ x: 0, z: 0 }, 0);
    const pose: CameraPose = camera.pose();
    const vector: CameraVector = pose.forward;
    const viewport: CameraViewport = { width: 800, height: 600 };
    const screen: CameraScreenPoint = camera.worldToScreen(point, viewport);
    const grid: GridCoordinate | undefined = camera.screenToGrid(screen, viewport, 0);
    const bounds: OrthographicBoundsMm = camera.orthographicBounds(viewport);
    const rotation: CameraRotation = state.rotation;
    const runtimeOptions: FoundationRuntimeOptions = {
      canvas: {} as HTMLCanvasElement,
      camera: cameraOptions,
    };
    const diagnostics: FoundationDiagnostics | undefined = undefined;
    const error: FoundationError | undefined = undefined;
    const ready: FoundationReady | undefined = undefined;
    const stateName: FoundationState = 'starting';
    const renderer: FoundationRenderer | undefined = undefined;
    const inspection: FoundationRenderInspection | undefined = undefined;
    const worker: FoundationWorker | undefined = undefined;
    const entityId: EntityId = formatEntityId({ slot: 0, generation: 1 });
    const entityHandle: EntityHandle | undefined = parseEntityId(entityId);
    const selectionPoint: ScreenPoint = { x: 0, y: 0 };
    const projectedBounds: ScreenBounds | undefined = boundsFromPoints([selectionPoint]);
    const selectionBounds: ScreenBounds | undefined = undefined;
    const selectionOptions: SelectionActionLayerOptions | undefined = undefined;
    const objectType: ObjectTypeDefinition = { id: 'foundation' };
    const scenario: ScenarioDefinition = { id: 'foundation' };
    const placementTarget: PlacementTarget = {
      objectType: objectType.id,
      x: 0,
      z: 0,
      elevationMm: 0,
      rotation: 0,
    };
    const transformTarget: EntityTransformTarget = placementTarget;
    const placement: PlacementValidation = {
      ...placementTarget,
      valid: true,
      occupiedCellCount: 1,
    };
    const preview: PlacementPreview = { ...placement, pending: false };

    expect(typeof createFoundationRuntime).toBe('function');
    expect(typeof CameraActionLayer).toBe('function');
    expect(typeof SelectionActionLayer).toBe('function');
    expect(
      viewportForCanvas({
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as HTMLCanvasElement),
    ).toEqual({
      width: 800,
      height: 600,
    });
    expect(typeof FoundationRuntime.prototype.dispose).toBe('function');
    expect(typeof FoundationRuntime.prototype.waitForReady).toBe('function');
    expect(typeof FoundationRuntime.prototype.selectedEntity).toBe('function');
    expect(typeof FoundationRuntime.prototype.step).toBe('function');
    expect([MAX_CAMERA_ZOOM_TILES, MIN_CAMERA_ZOOM_TILES, rotation]).toHaveLength(3);
    expect([
      vector,
      bounds,
      grid,
      runtimeOptions,
      diagnostics,
      error,
      ready,
      stateName,
      renderer,
      inspection,
      worker,
      entityId,
      entityHandle,
      projectedBounds,
      selectionPoint,
      selectionBounds,
      selectionOptions,
      objectType,
      scenario,
      placementTarget,
      transformTarget,
      placement,
      preview,
    ]).toHaveLength(23);
  });
});
