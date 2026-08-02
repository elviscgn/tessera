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
