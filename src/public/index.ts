/**
 * Public runtime entry point.
 *
 * The package surface is deliberately small: lifecycle and readiness, the
 * presentation camera, stable selection helpers, persistence adapters, and
 * the explicit canvas action layer. Scenario and gameplay contracts arrive
 * behind their own reviewed milestones.
 */
export {
  createFoundationRuntime,
  createFoundationRuntime as createTesseraRuntime,
  FoundationRuntime,
  FoundationRuntime as TesseraRuntime,
  type FoundationDiagnostics,
  type FoundationError,
  type FoundationReady,
  type FoundationRenderer,
  type FoundationRenderInspection,
  type FoundationRuntimeOptions,
  type FoundationRuntimeOptions as TesseraRuntimeOptions,
  type FoundationState,
  type FoundationWorker,
} from '../browser/foundation-runtime';

export {
  type EntityTransformTarget,
  type AssetManifest,
  type AssetManifestEntry,
  type LoadResult,
  type ObjectTypeDefinition,
  type PlacementPreview,
  type PlacementTarget,
  type PlacementValidation,
  type PersistenceAdapter,
  type ScenarioDefinition,
} from './runtime-types';

export {
  MemoryPersistenceAdapter,
  createIndexedDbPersistenceAdapter,
  exportSaveFile,
  importSaveFile,
  type IndexedDbPersistenceOptions,
} from '../persistence/adapters';

export {
  CameraProjection,
  DEFAULT_CAMERA_PITCH_RADIANS,
  DEFAULT_CAMERA_ZOOM_TILES,
  DEFAULT_TILE_SIZE_MM,
  MAX_CAMERA_ZOOM_TILES,
  MIN_CAMERA_ZOOM_TILES,
  type CameraPointMm,
  type CameraPose,
  type CameraProjectionOptions,
  type CameraRotation,
  type CameraScreenPoint,
  type CameraState,
  type CameraVector,
  type CameraViewport,
  type GridCoordinate,
  type OrthographicBoundsMm,
} from '../renderer/isometric-camera';

export {
  boundsFromPoints,
  formatEntityId,
  parseEntityId,
  type EntityHandle,
  type EntityId,
  type ScreenBounds,
  type ScreenPoint,
} from '../renderer/entity-selection';

export {
  SelectionActionLayer,
  type SelectionActionLayerOptions,
} from '../input/selection-action-layer';

export { CameraActionLayer } from '../input/camera-action-layer';

export { viewportForCanvas } from '../browser/canvas-viewport';
