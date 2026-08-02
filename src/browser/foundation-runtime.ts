import { BabylonRenderer, type RendererDiagnostics } from '../renderer/babylon-renderer';
import {
  decodeEventBatch,
  decodeRenderSnapshot,
  type RenderSnapshotMetadata,
} from '../worker/data-protocol';
import {
  type BoundaryMetrics,
  type CommandResultResponse,
  type WorkerRequest,
  type WorkerResponse,
} from '../worker/bridge-protocol';
import { ReliableEventReceiver, type EventStreamMetrics } from '../worker/reliable-events';
import { CameraProjection, type CameraProjectionOptions } from '../renderer/isometric-camera';

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
  readonly lastError?: FoundationError;
}

export interface FoundationReady {
  readonly protocolVersion: number;
  readonly adapterVersion: number;
  readonly tick: number;
  readonly metrics: BoundaryMetrics;
}

export interface FoundationRenderer {
  start(): void;
  consumeSnapshot(snapshot: RenderSnapshotMetadata): void;
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
}

type CommandPending = {
  readonly resolve: (response: CommandResultResponse) => void;
  readonly reject: (error: Error) => void;
};

type MetricsPending = {
  readonly resolve: (metrics: BoundaryMetrics) => void;
  readonly reject: (error: Error) => void;
};

const defaultSeed = (): Uint8Array => new Uint8Array(32).fill(7);

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
    consumeSnapshot: (snapshot) => renderer.consumeSnapshot(snapshot),
    diagnostics: () => renderer.diagnostics(),
    dispose: () => renderer.dispose(),
  };
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Lifecycle owner for the Milestone 3 foundation.
 *
 * The runtime owns one Worker, one Babylon renderer, all listeners, pending
 * requests, and the readiness state. It deliberately does not expose a
 * mutable simulation world or reconcile entity visuals yet.
 */
export class FoundationRuntime {
  public readonly ready: Promise<FoundationReady>;
  public readonly camera: CameraProjection;

  private readonly worker: FoundationWorker;
  private readonly renderer: FoundationRenderer;
  private readonly eventReceiver = new ReliableEventReceiver();
  private readonly pendingCommands = new Map<number, CommandPending>();
  private readonly pendingMetrics = new Map<number, MetricsPending>();
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
      this.worker.postMessage({ type: 'initialize', seed });
    } catch (error: unknown) {
      this.renderer.dispose();
      throw asError(error);
    }
  }

  public get state(): FoundationState {
    return this.currentState;
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

  public submitCommand(
    bytes: ArrayBuffer | Uint8Array,
    exactTicks: number,
  ): Promise<CommandResultResponse> {
    if (this.currentState !== 'ready') {
      return Promise.reject(new Error(`tessera:command:not_ready:runtime is ${this.currentState}`));
    }
    const requestId = this.allocateRequestId();
    const payload = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    return new Promise<CommandResultResponse>((resolve, reject) => {
      this.pendingCommands.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({ type: 'command', requestId, bytes: payload, exactTicks }, [
          payload,
        ]);
      } catch (error: unknown) {
        this.pendingCommands.delete(requestId);
        reject(asError(error));
      }
    });
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

  /** Disposes Worker, renderer, listeners, buffers, and pending requests once. */
  public dispose(): void {
    if (this.currentState === 'disposed') {
      return;
    }
    const disposeError = new Error('tessera:runtime:disposed:runtime has been disposed');
    const wasFatal = this.currentState === 'fatal';
    this.currentState = 'disposed';
    this.rejectPending(disposeError);
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
    if (response.type === 'startup-ready') {
      this.workerReady = true;
      this.simulationTick = BigInt(response.tick);
      this.latestMetrics = response.metrics;
      this.currentState = 'ready';
      const ready: FoundationReady = {
        protocolVersion: response.protocolVersion,
        adapterVersion: response.adapterVersion,
        tick: response.tick,
        metrics: response.metrics,
      };
      if (!this.readySettled) {
        this.readySettled = true;
        this.resolveReady(ready);
      }
      this.notifyDiagnostics();
      return;
    }
    if (response.type === 'command-result') {
      this.simulationTick = BigInt(response.tick);
      this.lastStateHashHex = response.stateHashHex;
      this.latestMetrics = response.metrics;
      this.pendingCommands.get(response.requestId)?.resolve(response);
      this.pendingCommands.delete(response.requestId);
      this.notifyDiagnostics();
      return;
    }
    if (response.type === 'event-batch') {
      this.handleEventBatch(response);
      return;
    }
    if (response.type === 'render-snapshot') {
      this.handleRenderSnapshot(response);
      return;
    }
    if (response.type === 'metrics') {
      this.latestMetrics = response.metrics;
      this.pendingMetrics.get(response.requestId)?.resolve(response.metrics);
      this.pendingMetrics.delete(response.requestId);
      this.notifyDiagnostics();
      return;
    }
    this.handleWorkerError(response);
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
      this.renderer.consumeSnapshot(snapshot);
      this.lastSnapshotGeneration = snapshot.snapshotGeneration;
      this.lastRenderTick = snapshot.simulationTick;
      this.lastEntityCount = snapshot.entityCount;
      this.latestMetrics = response.metrics;
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
      this.pendingMetrics.get(response.requestId)?.reject(error);
      this.pendingMetrics.delete(response.requestId);
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
    this.pendingCommands.clear();
    this.pendingMetrics.clear();
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

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private notifyDiagnostics(): void {
    const diagnostics = this.diagnostics();
    for (const listener of this.diagnosticListeners) {
      listener(diagnostics);
    }
  }
}

export const createFoundationRuntime = (options: FoundationRuntimeOptions): FoundationRuntime =>
  new FoundationRuntime(options);
