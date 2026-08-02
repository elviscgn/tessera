/** Explicitly development-only inspection, overlay, and reproduction helpers. */
export {
  registerTesseraTestBridge,
  TesseraTestBridge,
  type ReproductionCaptureOverrides,
  type TesseraTestBridgeDisposer,
  type TesseraTestBridgeOptions,
  type TestEntityRecord,
  type TestSynchronizationState,
} from '../testkit/test-bridge';

export {
  buildAnnotatedOverlayCapture,
  createAnnotatedOverlay,
  normalizeAnnotatedOverlayOptions,
  type AnnotatedEntity,
  type AnnotatedOverlayCapture,
  type AnnotatedOverlayCaptureInput,
  type AnnotatedOverlayController,
  type AnnotatedOverlayOptions,
  type NormalizedAnnotatedOverlayOptions,
} from '../testkit/annotated-overlay';

export {
  createReproductionBundle,
  downloadReproductionManifest,
  parseReproductionManifest,
  reproductionManifestEntry,
  serializeReproductionManifest,
  validateReproductionManifest,
  REPRODUCTION_BUNDLE_FORMAT,
  REPRODUCTION_BUNDLE_VERSION,
  type ReproductionArtifactKind,
  type ReproductionArtifactReference,
  type ReproductionBundleInput,
  type ReproductionBundleManifest,
  type ReproductionCommandRecord,
  type ReproductionDirectoryEntry,
  type ReproductionEnvironment,
  type ReproductionErrorRecord,
  type ReproductionHashRecord,
  type ReproductionLogRecord,
  type ReproductionSnapshotRecord,
} from '../testkit/reproduction-bundle';
