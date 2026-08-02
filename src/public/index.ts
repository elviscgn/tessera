/**
 * Foundation runtime entry point.
 *
 * This intentionally exposes only lifecycle/readiness primitives until later
 * milestones add the declarative scenario, camera, persistence, and gameplay
 * contracts described by the architecture plan.
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
