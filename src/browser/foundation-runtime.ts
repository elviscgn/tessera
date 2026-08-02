import { BabylonRenderer, type RendererDiagnostics } from '../renderer/babylon-renderer';
import {
  decodeOccupiedCells,
  decodeEventBatch,
  decodeRenderEntities,
  decodeRenderSnapshot,
  type RenderEntityRecord,
  type RenderGridCell,
  type RenderSnapshotMetadata,
} from '../worker/data-protocol';
import {
  type BoundaryMetrics,
  type CommandResultResponse,
  type LoadResultResponse,
  type PlacementValidationResponseMessage,
  type SaveResultResponse,
  type WorkerObjectTypeDefinition,
  type WorkerRequest,
  type WorkerResponse,
} from '../worker/bridge-protocol';
import { ReliableEventReceiver, type EventStreamMetrics } from '../worker/reliable-events';
import { CameraProjection, type CameraProjectionOptions } from '../renderer/isometric-camera';
import {
  parseEntityId,
  type EntityId,
  type EntityHandle,
  type ScreenBounds,
  type ScreenPoint,
} from '../renderer/entity-selection';
import {
  encodeMoveCommandBatch,
  encodeRemoveCommandBatch,
  encodeSpawnCommandBatch,
} from '../worker/bridge-protocol';
import type {
  EntityTransformTarget,
  LoadResult,
  ObjectTypeDefinition,
  PlacementPreview,
  PlacementTarget,
  PlacementValidation,
  PersistenceAdapter,
  ScenarioDefinition,
} from '../public/runtime-types';

export type FoundationState = 'starting' | 'ready' | 'fatal' | 'disposed';

export interface FoundationError {
  readonly code: string;
  readonly message: string;
  readonly phase: 'startup' | 'command' | 'fatal';
}

export interface FoundationDiagnostics {
  readonly state: FoundationState;
  readonly workerReady: boolean;
  readonly simulationTick: bigint;
  readonly lastSnapshotGeneration: bigint;
  readonly lastRenderTick: bigint;
  readonly lastEntityCount: number;
  readonly lastStateHashHex?: string;
  readonly metrics?: BoundaryMetrics;
  readonly eventStream: EventStreamMetrics;
  readonly renderer: RendererDiagnostics;
  readonly selectedEntityId?: EntityId;
  readonly placementPreview?: PlacementPreview;
  readonly lastError?: FoundationError;
}

export interface FoundationReady {
  readonly protocolVersion: number;
  readonly adapterVersion: number;
  readonly tick: number;
  readonly objectTypeHandles: readonly { readonly id: string; readonly handle: number }[];
  readonly metrics: BoundaryMetrics;
}

export interface FoundationRenderer {
  start(): void;
  consumeSnapshot(
    snapshot: RenderSnapshotMetadata,
    occupiedCells?: readonly RenderGridCell[],
    entities?: readonly RenderEntityRecord[],
  ): boolean | void;
  pick?(point: ScreenPoint): EntityId | undefined;
  selectedEntity?(): EntityId | undefined;
  subscribeSelection?(listener: (entityId: EntityId | undefined) => void): () => void;
  screenBounds?(entityId: EntityId): ScreenBounds | undefined;
  setPlacementPreview?(preview: PlacementPreview | undefined): void;
  diagnostics(): RendererDiagnostics;
  dispose(): void;
}

export interface FoundationWorker {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface FoundationRuntimeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly seed?: Uint8Array;
  readonly camera?: CameraProjectionOptions;
  readonly workerFactory?: () => FoundationWorker;
  readonly rendererFactory?: (
    canvas: HTMLCanvasElement,
    camera: CameraProjection,
  ) => FoundationRenderer;
  readonly objectTypes?: readonly ObjectTypeDefinition[];
  readonly scenario?: ScenarioDefinition;
  readonly persistenceAdapter?: PersistenceAdapter;
}

type CommandPending = {
  readonly resolve: (response: CommandResultResponse) => void;
  readonly reject: (error: Error) => void;
};

type MetricsPending = {
  readonly resolve: (metrics: BoundaryMetrics) => void;
  readonly reject: (error: Error) => void;
};

type PlacementPending = {
  readonly resolve: (result: PlacementValidation) => void;
  readonly reject: (error: Error) => void;
};

type SavePending = {
  readonly resolve: (result: Uint8Array) => void;
  readonly reject: (error: Error) => void;
};

type LoadPending = {
  readonly resolve: (result: LoadResult) => void;
  readonly reject: (error: Error) => void;
};

type PendingResolver<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
};

type EntityCommand = {
  readonly entity: EntityHandle;
  readonly ids: { readonly clientSequence: bigint; readonly batchSequence: bigint };
};

type WaitKind = 'simulationTick' | 'renderTick' | 'renderGeneration';

type Waiter = {
  readonly target: bigint;
  readonly resolve: (diagnostics: FoundationDiagnostics) => void;
  readonly reject: (error: Error) => void;
};

const defaultSeed = (): Uint8Array => new Uint8Array(32).fill(7);

const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const assertPublicId = (id: string, label: string): void => {
  if (id.length === 0 || id.length > 128 || !publicIdPattern.test(id)) {
    throw new Error(
      `tessera:startup:invalid_${label}_id:${label} IDs must be 1..128 ASCII characters`,
    );
  }
};

const assertI32Value = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`tessera:startup:invalid_${label}:${label} must be a signed 32-bit integer`);
  }
};

const normalizeObjectTypes = (
  definitions: readonly ObjectTypeDefinition[] | undefined,
): readonly WorkerObjectTypeDefinition[] => {
  const sorted = [...(definitions ?? [])].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const seen = new Set<string>();
  return sorted.map((definition) => {
    assertPublicId(definition.id, 'object_type');
    if (!seen.add(definition.id)) {
      throw new Error(`tessera:startup:duplicate_object_type_id:${definition.id}`);
    }
    const footprint = definition.footprint ?? [{ dx: 0, dz: 0 }];
    if (footprint.length === 0) {
      throw new Error(`tessera:startup:empty_footprint:${definition.id}`);
    }
    const flat: number[] = [];
    const offsets = new Set<string>();
    for (const offset of footprint) {
      assertI32Value(offset.dx, 'footprint_dx');
      assertI32Value(offset.dz, 'footprint_dz');
      const key = `${offset.dx}:${offset.dz}`;
      if (!offsets.add(key)) {
        throw new Error(`tessera:startup:duplicate_footprint_cell:${definition.id}:${key}`);
      }
      flat.push(offset.dx, offset.dz);
    }
    return { id: definition.id, footprint: flat };
  });
};

const normalizeScenario = (scenario: ScenarioDefinition | undefined): string | undefined => {
  if (scenario === undefined) {
    return undefined;
  }
  assertPublicId(scenario.id, 'scenario');
  return scenario.id;
};

const defaultWorkerFactory = (): FoundationWorker =>
  new Worker(new URL('../worker/foundation.worker.ts', import.meta.url), {
    name: 'tessera-runtime',
    type: 'module',
  });

const defaultRendererFactory = (
  canvas: HTMLCanvasElement,
  camera: CameraProjection,
): FoundationRenderer => {
  const renderer = new BabylonRenderer(canvas, camera);
  return {
    start: () => renderer.start(),
    consumeSnapshot: (snapshot, occupiedCells, entities) =>
      renderer.consumeSnapshot(snapshot, occupiedCells, entities),
    pick: (point) => renderer.pick(point),
    selectedEntity: () => renderer.selectedEntity(),
    subscribeSelection: (listener) => renderer.subscribeSelection(listener),
    screenBounds: (entityId) => renderer.screenBounds(entityId),
    setPlacementPreview: (preview) => renderer.setPlacementPreview(preview),
    diagnostics: () => renderer.diagnostics(),
    dispose: () => renderer.dispose(),
  };
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const normalizeWaitTarget = (value: number | bigint, label: string): bigint => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`tessera:wait:invalid_target:${label} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (value < 0n) {
    throw new Error(`tessera:wait:invalid_target:${label} must be non-negative`);
  }
  return value;
};

/**
 * Lifecycle owner for the browser runtime.
 *
 * The runtime owns one Worker, one Babylon renderer, all listeners, pending
 * requests, readiness, selection, and synchronization waits. It deliberately
 * does not expose a mutable simulation world.
 */
export class FoundationRuntime {
  public readonly ready: Promise<FoundationReady>;
  public readonly camera: CameraProjection;

  private readonly worker: FoundationWorker;
  private readonly renderer: FoundationRenderer;
  private readonly eventReceiver = new ReliableEventReceiver();
  private readonly pendingCommands = new Map<number, CommandPending>();
  private readonly pendingPlacements = new Map<number, PlacementPending>();
  private readonly pendingMetrics = new Map<number, MetricsPending>();
  private readonly pendingSaves = new Map<number, SavePending>();
  private readonly pendingLoads = new Map<number, LoadPending>();
  private readonly diagnosticListeners = new Set<(diagnostics: FoundationDiagnostics) => void>();
  private resolveReady!: (ready: FoundationReady) => void;
  private rejectReady!: (error: Error) => void;
  private nextRequestId = 1;
  private currentState: FoundationState = 'starting';
  private workerReady = false;
  private readySettled = false;
  private simulationTick = 0n;
  private lastSnapshotGeneration = 0n;
  private lastRenderTick = 0n;
  private lastEntityCount = 0;
  private lastStateHashHex: string | undefined;
  private latestMetrics: BoundaryMetrics | undefined;
  private lastError: FoundationError | undefined;
  private workerTerminated = false;
  private selectedEntityId: EntityId | undefined;
  private readonly selectionListeners = new Set<(entityId: EntityId | undefined) => void>();
  private readonly objectTypeHandles = new Map<string, number>();
  private nextClientSequence = 1n;
  private nextBatchSequence = 1n;
  private readonly persistenceAdapter: PersistenceAdapter | undefined;
  private placementPreview: PlacementPreview | undefined;
  private readonly waiters: Record<WaitKind, Waiter[]> = {
    simulationTick: [],
    renderTick: [],
    renderGeneration: [],
  };
  private readonly noErrorWaiters = new Set<Waiter>();
  private readonly responseHandlers: Readonly<
    Record<WorkerResponse['type'], (response: WorkerResponse) => void>
  > = {
    'startup-ready': (response) =>
      this.handleStartupReady(response as Extract<WorkerResponse, { type: 'startup-ready' }>),
    'placement-validation': (response) =>
      this.handlePlacementValidation(
        response as Extract<WorkerResponse, { type: 'placement-validation' }>,
      ),
    'command-result': (response) =>
      this.handleCommandResult(response as Extract<WorkerResponse, { type: 'command-result' }>),
    'save-result': (response) =>
      this.handleSaveResult(response as Extract<WorkerResponse, { type: 'save-result' }>),
    'load-result': (response) =>
      this.handleLoadResult(response as Extract<WorkerResponse, { type: 'load-result' }>),
    'event-batch': (response) =>
      this.handleEventBatch(response as Extract<WorkerResponse, { type: 'event-batch' }>),
    'render-snapshot': (response) =>
      this.handleRenderSnapshot(response as Extract<WorkerResponse, { type: 'render-snapshot' }>),
    metrics: (response) =>
      this.handleMetrics(response as Extract<WorkerResponse, { type: 'metrics' }>),
    'command-error': (response) =>
      this.handleWorkerError(response as Extract<WorkerResponse, { type: 'command-error' }>),
    'fatal-error': (response) =>
      this.handleWorkerError(response as Extract<WorkerResponse, { type: 'fatal-error' }>),
  };

  private readonly onMessage = (event: MessageEvent<WorkerResponse>): void => {
    this.handleMessage(event.data);
  };

  private readonly onWorkerError = (event: ErrorEvent): void => {
    this.transitionFatal('worker_error', event.message || 'the simulation Worker failed', 'fatal');
  };

  public constructor(options: FoundationRuntimeOptions) {
    const seed = options.seed ? new Uint8Array(options.seed) : defaultSeed();
    if (seed.byteLength !== 32) {
      throw new Error('tessera:startup:invalid_seed:seed must be 32 bytes');
    }
    const objectTypes = normalizeObjectTypes(options.objectTypes);
    const scenarioId = normalizeScenario(options.scenario);
    this.persistenceAdapter = options.persistenceAdapter;
    this.ready = new Promise<FoundationReady>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.camera = new CameraProjection(options.camera);
    this.renderer = (options.rendererFactory ?? defaultRendererFactory)(
      options.canvas,
      this.camera,
    );
    try {
      this.renderer.start();
      this.worker = (options.workerFactory ?? defaultWorkerFactory)();
      this.worker.addEventListener('message', this.onMessage);
      this.worker.addEventListener('error', this.onWorkerError);
      this.worker.postMessage({
        type: 'initialize',
        seed,
        objectTypes,
        ...(scenarioId === undefined ? {} : { scenarioId }),
      });
    } catch (error: unknown) {
      this.renderer.dispose();
      throw asError(error);
    }
  }

  public get state(): FoundationState {
    return this.currentState;
  }

  public waitForReady(): Promise<FoundationReady> {
    return this.ready;
  }

  public waitForSimulationTick(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.waitFor('simulationTick', normalizeWaitTarget(target, 'simulation tick'));
  }

  public waitForRenderedTick(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.waitFor('renderTick', normalizeWaitTarget(target, 'rendered tick'));
  }

  public waitForRenderGeneration(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.waitFor('renderGeneration', normalizeWaitTarget(target, 'render generation'));
  }

  public waitForNoPendingErrors(): Promise<FoundationDiagnostics> {
    if (this.currentState === 'ready' && this.lastError === undefined) {
      return Promise.resolve(this.diagnostics());
    }
    if (this.currentState === 'fatal' || this.currentState === 'disposed') {
      return Promise.reject(this.lifecycleError());
    }
    return new Promise<FoundationDiagnostics>((resolve, reject) => {
      this.noErrorWaiters.add({ target: 0n, resolve, reject });
    });
  }

  public diagnostics(): FoundationDiagnostics {
    const baseDiagnostics = {
      state: this.currentState,
      workerReady: this.workerReady,
      simulationTick: this.simulationTick,
      lastSnapshotGeneration: this.lastSnapshotGeneration,
      lastRenderTick: this.lastRenderTick,
      lastEntityCount: this.lastEntityCount,
      eventStream: this.eventReceiver.metrics(),
      renderer: this.renderer.diagnostics(),
      ...(this.selectedEntityId === undefined ? {} : { selectedEntityId: this.selectedEntityId }),
      ...(this.placementPreview === undefined ? {} : { placementPreview: this.placementPreview }),
    };
    return {
      ...baseDiagnostics,
      ...(this.lastStateHashHex === undefined ? {} : { lastStateHashHex: this.lastStateHashHex }),
      ...(this.latestMetrics === undefined ? {} : { metrics: this.latestMetrics }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    };
  }

  public subscribeDiagnostics(listener: (diagnostics: FoundationDiagnostics) => void): () => void {
    this.diagnosticListeners.add(listener);
    listener(this.diagnostics());
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  public pick(point: ScreenPoint): EntityId | undefined {
    if (this.currentState === 'disposed' || this.currentState === 'fatal') {
      return undefined;
    }
    const entityId = this.renderer.pick?.(point);
    this.setSelectedEntity(entityId);
    return entityId;
  }

  public selectedEntity(): EntityId | undefined {
    return this.selectedEntityId;
  }

  public subscribeSelection(listener: (entityId: EntityId | undefined) => void): () => void {
    this.selectionListeners.add(listener);
    listener(this.selectedEntityId);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  public screenBounds(entityId: EntityId): ScreenBounds | undefined {
    return this.renderer.screenBounds?.(entityId);
  }

  /** Returns the Rust-assigned handle for a configured public object ID. */
  public objectTypeHandle(id: string): number | undefined {
    return this.objectTypeHandles.get(id);
  }

  /** Queries Rust occupancy without mutating the world. */
  public validatePlacement(target: PlacementTarget): Promise<PlacementValidation> {
    this.assertPlacementTarget(target);
    const objectType = this.resolvePlacementHandle(target.objectType, 'placement');
    if (objectType instanceof Error) {
      return Promise.reject(objectType);
    }
    const requestId = this.allocateRequestId();
    return new Promise<PlacementValidation>((resolve, reject) => {
      this.pendingPlacements.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({
          type: 'validate-placement',
          requestId,
          input: {
            objectType,
            x: target.x,
            z: target.z,
            elevationMm: target.elevationMm,
            rotation: target.rotation,
          },
        });
      } catch (error: unknown) {
        this.pendingPlacements.delete(requestId);
        reject(asError(error));
      }
    });
  }

  /** Queries Rust and updates the renderer's presentation-only preview. */
  public async previewPlacement(target: PlacementTarget): Promise<PlacementValidation> {
    this.assertPlacementTarget(target);
    const pending: PlacementPreview = {
      ...target,
      valid: false,
      occupiedCellCount: 0,
      pending: true,
    };
    this.applyPlacementPreview(pending);
    const result = await this.validatePlacement(target);
    const current = this.placementPreview;
    if (current !== undefined && this.placementKey(current) === this.placementKey(target)) {
      this.applyPlacementPreview({ ...result, pending: false });
    }
    return result;
  }

  /** Clears the current presentation-only placement preview. */
  public clearPlacementPreview(): void {
    this.applyPlacementPreview(undefined);
  }

  private applyPlacementPreview(preview: PlacementPreview | undefined): void {
    this.placementPreview = preview;
    this.renderer.setPlacementPreview?.(preview);
    this.notifyDiagnostics();
  }

  /** Schedules an authoritative placement for the next unstarted tick. */
  public placeObject(target: PlacementTarget, exactTicks = 1): Promise<CommandResultResponse> {
    this.assertPlacementTarget(target);
    const objectType = this.resolvePlacementHandle(target.objectType, 'command');
    if (objectType instanceof Error) {
      return Promise.reject(objectType);
    }
    const ids = this.allocateCommandIds();
    return this.submitCommand(
      encodeSpawnCommandBatch({
        batchSequence: ids.batchSequence,
        clientSequence: ids.clientSequence,
        objectType,
        x: target.x,
        z: target.z,
        elevationMm: target.elevationMm,
        rotation: target.rotation,
      }),
      exactTicks,
    );
  }

  /** Schedules an authoritative move for the next unstarted tick. */
  public moveObject(
    entityId: EntityId,
    target: EntityTransformTarget,
    exactTicks = 1,
  ): Promise<CommandResultResponse> {
    this.assertTransformTarget(target);
    const command = this.prepareEntityCommand(entityId);
    if (command instanceof Error) {
      return Promise.reject(command);
    }
    return this.submitCommand(
      encodeMoveCommandBatch({
        batchSequence: command.ids.batchSequence,
        clientSequence: command.ids.clientSequence,
        slot: command.entity.slot,
        generation: command.entity.generation,
        x: target.x,
        z: target.z,
        elevationMm: target.elevationMm,
        rotation: target.rotation,
      }),
      exactTicks,
    );
  }

  /** Schedules an authoritative removal for the next unstarted tick. */
  public removeEntity(entityId: EntityId, exactTicks = 1): Promise<CommandResultResponse> {
    const command = this.prepareEntityCommand(entityId);
    if (command instanceof Error) {
      return Promise.reject(command);
    }
    return this.submitCommand(
      encodeRemoveCommandBatch({
        batchSequence: command.ids.batchSequence,
        clientSequence: command.ids.clientSequence,
        slot: command.entity.slot,
        generation: command.entity.generation,
      }),
      exactTicks,
    );
  }

  public submitCommand(
    bytes: ArrayBuffer | Uint8Array,
    exactTicks: number,
  ): Promise<CommandResultResponse> {
    const payload = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    return this.postPending(this.pendingCommands, 'command', (requestId) => ({
      message: { type: 'command', requestId, bytes: payload, exactTicks },
      transfer: [payload],
    }));
  }

  public requestMetrics(): Promise<BoundaryMetrics> {
    if (this.currentState === 'disposed') {
      return Promise.reject(new Error('tessera:runtime:disposed:runtime has been disposed'));
    }
    const requestId = this.allocateRequestId();
    return new Promise<BoundaryMetrics>((resolve, reject) => {
      this.pendingMetrics.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({ type: 'metrics', requestId });
      } catch (error: unknown) {
        this.pendingMetrics.delete(requestId);
        reject(asError(error));
      }
    });
  }

  /** Requests an opaque, Rust-generated save at the current tick boundary. */
  public save(): Promise<Uint8Array> {
    return this.postPending(this.pendingSaves, 'save', (requestId) => ({
      message: { type: 'save', requestId },
    }));
  }

  /** Saves through the adapter supplied at runtime construction. */
  public async saveToPersistence(): Promise<void> {
    if (this.persistenceAdapter === undefined) {
      throw new Error('tessera:persistence:unconfigured:no persistence adapter was supplied');
    }
    await this.persistenceAdapter.write(await this.save());
  }

  /** Loads opaque save bytes; the Worker preserves the active world on failure. */
  public load(bytes: ArrayBuffer | Uint8Array): Promise<LoadResult> {
    const payload = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    return this.postPending(this.pendingLoads, 'load', (requestId) => ({
      message: { type: 'load', requestId, bytes: payload },
      transfer: [payload],
    }));
  }

  /** Reads and loads through the adapter supplied at runtime construction. */
  public async loadFromPersistence(): Promise<LoadResult> {
    if (this.persistenceAdapter === undefined) {
      throw new Error('tessera:persistence:unconfigured:no persistence adapter was supplied');
    }
    const bytes = await this.persistenceAdapter.read();
    if (bytes === undefined) {
      throw new Error('tessera:persistence:missing:no save is available');
    }
    return this.load(bytes);
  }

  /** Disposes Worker, renderer, listeners, buffers, and pending requests once. */
  public dispose(): void {
    if (this.currentState === 'disposed') {
      return;
    }
    const disposeError = new Error('tessera:runtime:disposed:runtime has been disposed');
    const wasFatal = this.currentState === 'fatal';
    this.currentState = 'disposed';
    this.rejectPending(disposeError);
    this.rejectWaiters(disposeError);
    if (!wasFatal) {
      try {
        this.worker.postMessage({ type: 'dispose' });
      } catch {
        // Termination below is the final ownership boundary.
      }
    }
    this.detachWorker();
    this.terminateWorker();
    this.renderer.dispose();
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(disposeError);
    }
    this.notifyDiagnostics();
  }

  private handleMessage(response: WorkerResponse): void {
    if (this.currentState === 'disposed') {
      return;
    }
    this.responseHandlers[response.type](response);
  }

  private handleStartupReady(response: Extract<WorkerResponse, { type: 'startup-ready' }>): void {
    this.workerReady = true;
    this.simulationTick = BigInt(response.tick);
    this.latestMetrics = response.metrics;
    this.objectTypeHandles.clear();
    for (const entry of response.objectTypeHandles) {
      this.objectTypeHandles.set(entry.id, entry.handle);
    }
    this.currentState = 'ready';
    const ready: FoundationReady = {
      protocolVersion: response.protocolVersion,
      adapterVersion: response.adapterVersion,
      tick: response.tick,
      objectTypeHandles: response.objectTypeHandles,
      metrics: response.metrics,
    };
    if (!this.readySettled) {
      this.readySettled = true;
      this.resolveReady(ready);
    }
    this.notifyDiagnostics();
  }

  private handleCommandResult(response: Extract<WorkerResponse, { type: 'command-result' }>): void {
    this.simulationTick = BigInt(response.tick);
    this.lastStateHashHex = response.stateHashHex;
    this.latestMetrics = response.metrics;
    this.lastError = undefined;
    this.pendingCommands.get(response.requestId)?.resolve(response);
    this.pendingCommands.delete(response.requestId);
    this.notifyDiagnostics();
  }

  private handleSaveResult(response: SaveResultResponse): void {
    this.simulationTick = BigInt(response.tick);
    this.lastStateHashHex = response.stateHashHex;
    this.latestMetrics = response.metrics;
    this.lastError = undefined;
    const pending = this.pendingSaves.get(response.requestId);
    if (pending !== undefined) {
      if (response.byteLength !== response.bytes.byteLength) {
        pending.reject(new Error('tessera:save:invalid_length:save response length is invalid'));
      } else {
        pending.resolve(new Uint8Array(response.bytes).slice());
      }
    }
    this.pendingSaves.delete(response.requestId);
    this.notifyDiagnostics();
  }

  private handleLoadResult(response: LoadResultResponse): void {
    this.simulationTick = BigInt(response.tick);
    this.lastStateHashHex = response.stateHashHex;
    this.latestMetrics = response.metrics;
    this.lastError = undefined;
    this.nextClientSequence = response.nextClientSequence;
    this.eventReceiver.reset();
    this.setSelectedEntity(undefined);
    this.applyPlacementPreview(undefined);
    const pending = this.pendingLoads.get(response.requestId);
    pending?.resolve({
      tick: BigInt(response.tick),
      stateHashHex: response.stateHashHex,
      worldGeneration: response.worldGeneration,
    });
    this.pendingLoads.delete(response.requestId);
    this.notifyDiagnostics();
  }

  private handleMetrics(response: Extract<WorkerResponse, { type: 'metrics' }>): void {
    this.latestMetrics = response.metrics;
    this.pendingMetrics.get(response.requestId)?.resolve(response.metrics);
    this.pendingMetrics.delete(response.requestId);
    this.notifyDiagnostics();
  }

  private handlePlacementValidation(response: PlacementValidationResponseMessage): void {
    this.latestMetrics = response.metrics;
    const objectType = [...this.objectTypeHandles.entries()].find(
      ([, handle]) => handle === response.result.objectType,
    )?.[0];
    const pending = this.pendingPlacements.get(response.requestId);
    if (pending === undefined || objectType === undefined) {
      this.pendingPlacements.delete(response.requestId);
      if (objectType === undefined) {
        this.transitionFatal(
          'placement_object_type_unknown',
          'Worker returned a placement handle that was not registered at startup',
          'fatal',
        );
      }
      return;
    }
    pending.resolve({
      objectType,
      x: response.result.x,
      z: response.result.z,
      elevationMm: response.result.elevationMm,
      rotation: response.result.rotation,
      valid: response.result.valid,
      ...(response.result.rejectionCode === undefined
        ? {}
        : { rejectionCode: response.result.rejectionCode }),
      occupiedCellCount: response.result.occupiedCellCount,
    });
    this.pendingPlacements.delete(response.requestId);
    this.notifyDiagnostics();
  }

  private handleEventBatch(response: Extract<WorkerResponse, { type: 'event-batch' }>): void {
    try {
      const metadata = decodeEventBatch(response.bytes);
      if (
        metadata.firstSequence !== response.firstSequence ||
        metadata.lastSequence !== response.lastSequence ||
        metadata.recordCount !== response.recordCount ||
        metadata.ackFloor !== response.ackFloor
      ) {
        throw new Error('event response metadata does not match its packed batch');
      }
      const result = this.eventReceiver.accept(metadata);
      this.latestMetrics = response.metrics;
      if (result.type === 'gap') {
        const afterSequence = this.eventReceiver.requestResync();
        this.worker.postMessage({ type: 'request-events', afterSequence, resync: true });
      } else if (result.type === 'accepted') {
        this.worker.postMessage({
          type: 'ack-events',
          highestContiguousSequence: result.highestContiguousSequence,
        });
      }
      this.notifyDiagnostics();
    } catch (error: unknown) {
      this.transitionFatal('event_stream_invalid', asError(error).message, 'fatal');
    }
  }

  private handleRenderSnapshot(
    response: Extract<WorkerResponse, { type: 'render-snapshot' }>,
  ): void {
    let failure: Error | undefined;
    try {
      const snapshot = decodeRenderSnapshot(
        new Uint8Array(response.buffer, 0, response.byteLength),
      );
      if (
        snapshot.snapshotGeneration !== response.snapshotGeneration ||
        snapshot.simulationTick !== response.simulationTick
      ) {
        throw new Error('render response metadata does not match its packed snapshot');
      }
      const applied = this.renderer.consumeSnapshot(
        snapshot,
        decodeOccupiedCells(new Uint8Array(response.buffer, 0, response.byteLength), snapshot),
        decodeRenderEntities(new Uint8Array(response.buffer, 0, response.byteLength), snapshot),
      );
      this.latestMetrics = response.metrics;
      if (applied !== false) {
        this.lastSnapshotGeneration = snapshot.snapshotGeneration;
        this.lastRenderTick = snapshot.simulationTick;
        this.lastEntityCount = snapshot.entityCount;
      }
    } catch (error: unknown) {
      failure = asError(error);
    }
    try {
      this.worker.postMessage(
        { type: 'return-render-buffer', bufferId: response.bufferId, buffer: response.buffer },
        [response.buffer],
      );
    } catch (error: unknown) {
      failure ??= asError(error);
    }
    if (failure) {
      this.transitionFatal('render_snapshot_invalid', failure.message, 'fatal');
    } else {
      this.notifyDiagnostics();
    }
  }

  private handleWorkerError(
    response: Extract<WorkerResponse, { type: 'command-error' | 'fatal-error' }>,
  ): void {
    if (response.metrics !== undefined) {
      this.latestMetrics = response.metrics;
    }
    const error = new Error(`tessera:${response.phase}:${response.code}:${response.message}`);
    if (response.type === 'fatal-error') {
      this.transitionFatal(response.code, response.message, response.phase);
      return;
    }
    this.lastError = { code: response.code, message: response.message, phase: response.phase };
    if (response.requestId !== undefined) {
      this.pendingCommands.get(response.requestId)?.reject(error);
      this.pendingCommands.delete(response.requestId);
      this.pendingPlacements.get(response.requestId)?.reject(error);
      this.pendingPlacements.delete(response.requestId);
      this.pendingMetrics.get(response.requestId)?.reject(error);
      this.pendingMetrics.delete(response.requestId);
      this.pendingSaves.get(response.requestId)?.reject(error);
      this.pendingSaves.delete(response.requestId);
      this.pendingLoads.get(response.requestId)?.reject(error);
      this.pendingLoads.delete(response.requestId);
    }
    this.notifyDiagnostics();
  }

  private transitionFatal(
    code: string,
    message: string,
    phase: 'startup' | 'command' | 'fatal',
  ): void {
    if (this.currentState === 'fatal' || this.currentState === 'disposed') {
      return;
    }
    const error = new Error(`tessera:${phase}:${code}:${message}`);
    this.currentState = 'fatal';
    this.lastError = { code, message, phase };
    this.rejectPending(error);
    this.rejectWaiters(error);
    this.detachWorker();
    this.terminateWorker();
    this.renderer.dispose();
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(error);
    }
    this.notifyDiagnostics();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingCommands.values()) {
      pending.reject(error);
    }
    for (const pending of this.pendingMetrics.values()) {
      pending.reject(error);
    }
    for (const pending of this.pendingPlacements.values()) {
      pending.reject(error);
    }
    for (const pending of this.pendingSaves.values()) {
      pending.reject(error);
    }
    for (const pending of this.pendingLoads.values()) {
      pending.reject(error);
    }
    this.pendingCommands.clear();
    this.pendingMetrics.clear();
    this.pendingPlacements.clear();
    this.pendingSaves.clear();
    this.pendingLoads.clear();
  }

  private detachWorker(): void {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
  }

  private terminateWorker(): void {
    if (this.workerTerminated) {
      return;
    }
    this.workerTerminated = true;
    this.worker.terminate();
  }

  private assertPlacementTarget(target: PlacementTarget): void {
    assertPublicId(target.objectType, 'object_type');
    this.assertTransformTarget(target);
  }

  private assertTransformTarget(target: EntityTransformTarget): void {
    assertI32Value(target.x, 'x');
    assertI32Value(target.z, 'z');
    assertI32Value(target.elevationMm, 'elevation_mm');
    if (!Number.isInteger(target.rotation) || target.rotation < 0 || target.rotation > 3) {
      throw new Error('tessera:placement:invalid_rotation:rotation must be in the range 0..3');
    }
  }

  private resolvePlacementHandle(id: string, phase: 'placement' | 'command'): number | Error {
    if (this.currentState !== 'ready') {
      return new Error(`tessera:${phase}:not_ready:runtime is ${this.currentState}`);
    }
    const handle = this.objectTypeHandles.get(id);
    return handle === undefined ? new Error(`tessera:${phase}:unknown_object_type:${id}`) : handle;
  }

  private prepareEntityCommand(entityId: EntityId): EntityCommand | Error {
    const entity = parseEntityId(entityId);
    if (entity === undefined) {
      return new Error(`tessera:command:invalid_entity_id:${entityId}`);
    }
    if (this.currentState !== 'ready') {
      return new Error(`tessera:command:not_ready:runtime is ${this.currentState}`);
    }
    return { entity, ids: this.allocateCommandIds() };
  }

  private allocateCommandIds(): {
    readonly clientSequence: bigint;
    readonly batchSequence: bigint;
  } {
    const clientSequence = this.nextClientSequence;
    const batchSequence = this.nextBatchSequence;
    if (clientSequence === 0xffff_ffff_ffff_ffffn || batchSequence === 0xffff_ffff_ffff_ffffn) {
      throw new Error('tessera:command:sequence_exhausted:command sequence space is exhausted');
    }
    this.nextClientSequence += 1n;
    this.nextBatchSequence += 1n;
    return { clientSequence, batchSequence };
  }

  private placementKey(target: PlacementTarget): string {
    return `${target.objectType}:${target.x}:${target.z}:${target.elevationMm}:${target.rotation}`;
  }

  private postPending<T>(
    pending: Map<number, PendingResolver<T>>,
    phase: string,
    build: (requestId: number) => {
      readonly message: WorkerRequest;
      readonly transfer?: Transferable[];
    },
  ): Promise<T> {
    if (this.currentState !== 'ready') {
      return Promise.reject(
        new Error(`tessera:${phase}:not_ready:runtime is ${this.currentState}`),
      );
    }
    const requestId = this.allocateRequestId();
    const request = build(requestId);
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(request.message, request.transfer ?? []);
      } catch (error: unknown) {
        pending.delete(requestId);
        reject(asError(error));
      }
    });
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private notifyDiagnostics(): void {
    const diagnostics = this.diagnostics();
    this.resolveWaiters(diagnostics);
    for (const listener of this.diagnosticListeners) {
      listener(diagnostics);
    }
  }

  private readonly waitFor = (kind: WaitKind, target: bigint): Promise<FoundationDiagnostics> => {
    if (this.currentState === 'fatal' || this.currentState === 'disposed') {
      return Promise.reject(this.lifecycleError());
    }
    if (this.currentState === 'ready' && this.waitValue(kind) >= target) {
      return Promise.resolve(this.diagnostics());
    }
    return new Promise<FoundationDiagnostics>((resolve, reject) => {
      this.waiters[kind].push({ target, resolve, reject });
    });
  };

  private readonly waitValue = (kind: WaitKind): bigint => {
    if (kind === 'simulationTick') {
      return this.simulationTick;
    }
    if (kind === 'renderTick') {
      return this.lastRenderTick;
    }
    return this.lastSnapshotGeneration;
  };

  private readonly resolveWaiters = (diagnostics: FoundationDiagnostics): void => {
    for (const kind of Object.keys(this.waiters) as WaitKind[]) {
      const pending = this.waiters[kind];
      const ready = pending.filter((waiter) => this.waitValue(kind) >= waiter.target);
      this.waiters[kind] = pending.filter((waiter) => this.waitValue(kind) < waiter.target);
      for (const waiter of ready) {
        waiter.resolve(diagnostics);
      }
    }
    if (this.currentState === 'ready' && this.lastError === undefined) {
      for (const waiter of this.noErrorWaiters) {
        waiter.resolve(diagnostics);
      }
      this.noErrorWaiters.clear();
    }
  };

  private readonly rejectWaiters = (error: Error): void => {
    for (const kind of Object.keys(this.waiters) as WaitKind[]) {
      for (const waiter of this.waiters[kind]) {
        waiter.reject(error);
      }
      this.waiters[kind] = [];
    }
    for (const waiter of this.noErrorWaiters) {
      waiter.reject(error);
    }
    this.noErrorWaiters.clear();
  };

  private readonly lifecycleError = (): Error =>
    new Error(`tessera:wait:lifecycle:runtime is ${this.currentState}`);

  private readonly setSelectedEntity = (entityId: EntityId | undefined): void => {
    if (this.selectedEntityId === entityId) {
      return;
    }
    this.selectedEntityId = entityId;
    for (const listener of this.selectionListeners) {
      listener(entityId);
    }
    this.notifyDiagnostics();
  };
}

export const createFoundationRuntime = (options: FoundationRuntimeOptions): FoundationRuntime =>
  new FoundationRuntime(options);
