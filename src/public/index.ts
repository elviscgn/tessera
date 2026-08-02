/**
 * Public runtime entry point.
 *
 * The package surface is deliberately small: lifecycle and readiness, the
 * presentation camera, stable selection helpers, and the explicit canvas
 * action layer. Scenario, persistence, and gameplay contracts arrive behind
 * their own reviewed milestones.
 */
export {
  createFoundationRuntime,
  FoundationRuntime,
  type FoundationDiagnostics,
  type FoundationError,
  type FoundationReady,
  type FoundationRenderer,
  type FoundationRuntimeOptions,
  type FoundationState,
  type FoundationWorker,
} from '../browser/foundation-runtime';

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
