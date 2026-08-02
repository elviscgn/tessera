import { describe, expect, it } from 'vitest';
import {
  createFoundationRuntime,
  type FoundationRenderer,
  type FoundationWorker,
} from '../../src/browser/foundation-runtime';
import { MemoryPersistenceAdapter } from '../../src/public/index';
import type { RendererDiagnostics } from '../../src/renderer/babylon-renderer';
import type {
  BoundaryMetrics,
  WorkerRequest,
  WorkerResponse,
} from '../../src/worker/bridge-protocol';

const metrics = (): BoundaryMetrics => ({
  commandCalls: 0,
  commandBytes: 0,
  eventBatches: 0,
  eventBytes: 0,
  highestAcknowledgedEvent: 0,
  eventGapCount: 0,
  eventResyncCount: 0,
  renderSnapshots: 0,
  renderBytes: 0,
  droppedRenderSnapshots: 0,
  inFlightRenderBuffers: 0,
  renderBufferPoolSize: 3,
  renderBufferHighWaterMark: 0,
  memoryGeneration: 1,
  memoryBufferBytes: 65536,
  viewRecreations: 1,
  saveCalls: 0,
  saveBytes: 0,
  loadCalls: 0,
  loadBytes: 0,
});

const packedEmptySnapshot = (): ArrayBuffer => {
  const bytes = new Uint8Array(352);
  const view = new DataView(bytes.buffer);
  bytes.set([84, 83, 82, 78, 68, 48, 48, 49], 0);
  view.setUint16(8, 1, true);
  view.setUint16(10, 64, true);
  view.setUint32(16, bytes.byteLength, true);
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 1n, true);
  view.setBigUint64(32, 1n, true);
  view.setUint32(40, 0, true);
  view.setUint32(44, 0, true);
  view.setUint32(48, 1, true);
  view.setUint16(52, 9, true);
  view.setUint16(54, 32, true);
  view.setUint32(56, 64, true);
  const regionLayouts: ReadonlyArray<readonly [number, number, number]> = [
    [1, 3, 1],
    [2, 3, 1],
    [3, 4, 3],
    [4, 5, 4],
    [5, 5, 3],
    [6, 3, 1],
    [7, 3, 1],
    [8, 2, 1],
    [9, 2, 1],
  ];
  for (const [index, [kind, scalarType, componentCount]] of regionLayouts.entries()) {
    const offset = 64 + index * 32;
    view.setUint16(offset, kind, true);
    view.setUint8(offset + 2, scalarType);
    view.setUint8(offset + 3, componentCount);
    view.setUint32(offset + 8, 352, true);
    view.setUint32(offset + 12, 0, true);
    view.setUint32(offset + 16, 0, true);
    view.setUint32(offset + 20, 0, true);
  }
  return bytes.buffer;
};

class FakeRenderer implements FoundationRenderer {
  public starts = 0;
  public consumed = 0;
  public disposals = 0;
  private snapshotGeneration = 0n;
  private simulationTick = 0n;
  private entityCount = 0;

  public start(): void {
    this.starts += 1;
  }

  public consumeSnapshot(snapshot: {
    snapshotGeneration: bigint;
    simulationTick: bigint;
    entityCount: number;
  }): void {
    this.consumed += 1;
    this.snapshotGeneration = snapshot.snapshotGeneration;
    this.simulationTick = snapshot.simulationTick;
    this.entityCount = snapshot.entityCount;
  }

  public diagnostics(): RendererDiagnostics {
    return {
      renderFrames: this.starts,
      receivedSnapshots: this.consumed,
      lastSnapshotGeneration: this.snapshotGeneration,
      lastWorldGeneration: 1,
      lastSimulationTick: this.simulationTick,
      lastEntityCount: this.entityCount,
      disposed: this.disposals > 0,
    };
  }

  public dispose(): void {
    this.disposals += 1;
  }
}

class FakeWorker implements FoundationWorker {
  public readonly messages: Array<{ message: WorkerRequest; transfer: Transferable[] }> = [];
  public terminations = 0;
  private readonly messageListeners = new Set<(event: MessageEvent<WorkerResponse>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  public postMessage(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push({ message, transfer });
  }

  public addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<WorkerResponse>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent<WorkerResponse>) => void);
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  public removeEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<WorkerResponse>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent<WorkerResponse>) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  public terminate(): void {
    this.terminations += 1;
  }

  public emit(response: WorkerResponse): void {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<WorkerResponse>);
    }
  }

  public emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message } as ErrorEvent);
    }
  }
}

const latestRequest = (worker: FakeWorker): WorkerRequest => {
  const request = worker.messages.at(-1)?.message;
  if (request === undefined) {
    throw new Error('expected a Worker request');
  }
  return request;
};

const latestCommandRequest = (worker: FakeWorker): Extract<WorkerRequest, { type: 'command' }> => {
  const request = latestRequest(worker);
  if (request.type !== 'command') {
    throw new Error('expected a command request');
  }
  return request;
};

const latestPlacementRequest = (
  worker: FakeWorker,
): Extract<WorkerRequest, { type: 'validate-placement' }> => {
  const request = latestRequest(worker);
  if (request.type !== 'validate-placement') {
    throw new Error('expected a placement validation request');
  }
  return request;
};

describe('foundation runtime lifecycle', () => {
  it('owns readiness, Worker synchronization, snapshot returns, and idempotent disposal', async () => {
    const worker = new FakeWorker();
    const renderer = new FakeRenderer();
    const runtime = createFoundationRuntime({
      canvas: {} as HTMLCanvasElement,
      workerFactory: () => worker,
      rendererFactory: () => renderer,
    });

    expect(renderer.starts).toBe(1);
    expect(worker.messages[0]?.message.type).toBe('initialize');
    expect(runtime.waitForReady()).toBe(runtime.ready);
    expect(runtime.selectedEntity()).toBeUndefined();
    await expect(runtime.submitCommand(new ArrayBuffer(0), 0)).rejects.toThrow('not_ready');
    const simulationWait = runtime.waitForSimulationTick(1);
    const renderWait = runtime.waitForRenderedTick(1);
    const generationWait = runtime.waitForRenderGeneration(1);
    const noErrorWait = runtime.waitForNoPendingErrors();

    worker.emit({
      type: 'startup-ready',
      protocolVersion: 1,
      adapterVersion: 1,
      tick: 0,
      objectTypeHandles: [],
      metrics: metrics(),
    });
    await expect(runtime.ready).resolves.toMatchObject({ tick: 0, protocolVersion: 1 });
    await expect(noErrorWait).resolves.toMatchObject({ state: 'ready' });

    const commandPromise = runtime.submitCommand(new Uint8Array([1, 2, 3]), 1);
    const commandMessage = worker.messages.at(-1)?.message;
    expect(commandMessage?.type).toBe('command');
    if (commandMessage?.type !== 'command') {
      throw new Error('expected a command request');
    }
    worker.emit({
      type: 'command-result',
      requestId: commandMessage.requestId,
      batchSequence: 1,
      tick: 1,
      stateHashHex: 'ab'.repeat(32),
      response: new ArrayBuffer(64),
      metrics: metrics(),
    });
    await expect(commandPromise).resolves.toMatchObject({ tick: 1, stateHashHex: 'ab'.repeat(32) });
    await expect(simulationWait).resolves.toMatchObject({ simulationTick: 1n });

    const snapshotBuffer = packedEmptySnapshot();
    worker.emit({
      type: 'render-snapshot',
      bufferId: 0,
      snapshotGeneration: 1n,
      simulationTick: 1n,
      byteLength: snapshotBuffer.byteLength,
      buffer: snapshotBuffer,
      metrics: metrics(),
    });
    await expect(renderWait).resolves.toMatchObject({ lastRenderTick: 1n });
    await expect(generationWait).resolves.toMatchObject({ lastSnapshotGeneration: 1n });
    expect(renderer.consumed).toBe(1);
    expect(worker.messages.at(-1)?.message.type).toBe('return-render-buffer');
    expect(runtime.diagnostics()).toMatchObject({
      state: 'ready',
      simulationTick: 1n,
      lastSnapshotGeneration: 1n,
      lastRenderTick: 1n,
    });

    const metricPromise = runtime.requestMetrics();
    const metricRequest = worker.messages.at(-1)?.message;
    expect(metricRequest?.type).toBe('metrics');
    if (metricRequest?.type !== 'metrics') {
      throw new Error('expected a metrics request');
    }
    worker.emit({ type: 'metrics', requestId: metricRequest.requestId, metrics: metrics() });
    await expect(metricPromise).resolves.toMatchObject({ memoryGeneration: 1 });

    runtime.dispose();
    runtime.dispose();
    expect(worker.terminations).toBe(1);
    expect(renderer.disposals).toBe(1);
    expect(runtime.state).toBe('disposed');
    expect(runtime.renderInspection()).toEqual({ entities: [], occupiedCells: [] });
  });

  it('fails closed and disposes both owners on a startup failure', async () => {
    const worker = new FakeWorker();
    const renderer = new FakeRenderer();
    const runtime = createFoundationRuntime({
      canvas: {} as HTMLCanvasElement,
      workerFactory: () => worker,
      rendererFactory: () => renderer,
    });
    const ready = runtime.ready;
    worker.emit({
      type: 'fatal-error',
      phase: 'startup',
      code: 'wasm_init',
      message: 'init failed',
      metrics: metrics(),
    });
    await expect(ready).rejects.toThrow('wasm_init');
    expect(runtime.state).toBe('fatal');
    expect(worker.terminations).toBe(1);
    expect(renderer.disposals).toBe(1);
    expect(runtime.diagnostics().lastError?.code).toBe('wasm_init');
  });

  it('saves and loads opaque bytes while preserving failed-load state', async () => {
    const worker = new FakeWorker();
    const renderer = new FakeRenderer();
    const runtime = createFoundationRuntime({
      canvas: {} as HTMLCanvasElement,
      workerFactory: () => worker,
      rendererFactory: () => renderer,
    });
    worker.emit({
      type: 'startup-ready',
      protocolVersion: 1,
      adapterVersion: 1,
      tick: 0,
      objectTypeHandles: [],
      metrics: metrics(),
    });
    await runtime.ready;

    const savePromise = runtime.save();
    const saveRequest = latestRequest(worker);
    expect(saveRequest.type).toBe('save');
    if (saveRequest.type !== 'save') {
      throw new Error('expected a save request');
    }
    const saveBytes = new Uint8Array([123, 125]).buffer;
    worker.emit({
      type: 'save-result',
      requestId: saveRequest.requestId,
      tick: 0,
      stateHashHex: 'ab'.repeat(32),
      byteLength: saveBytes.byteLength,
      bytes: saveBytes,
      metrics: metrics(),
    });
    await expect(savePromise).resolves.toEqual(new Uint8Array([123, 125]));

    const loadPromise = runtime.load(new Uint8Array([123, 125]));
    const loadRequest = latestRequest(worker);
    expect(loadRequest.type).toBe('load');
    if (loadRequest.type !== 'load') {
      throw new Error('expected a load request');
    }
    worker.emit({
      type: 'load-result',
      requestId: loadRequest.requestId,
      tick: 4,
      stateHashHex: 'cd'.repeat(32),
      worldGeneration: 2,
      nextClientSequence: 5n,
      metrics: metrics(),
    });
    await expect(loadPromise).resolves.toMatchObject({
      tick: 4n,
      worldGeneration: 2,
      stateHashHex: 'cd'.repeat(32),
    });
    expect(runtime.diagnostics()).toMatchObject({ simulationTick: 4n });

    const failedLoad = runtime.load(new Uint8Array([0]));
    const failedRequest = latestRequest(worker);
    if (failedRequest.type !== 'load') {
      throw new Error('expected a failed load request');
    }
    worker.emit({
      type: 'command-error',
      phase: 'command',
      code: 'checksum_mismatch',
      message: 'save checksum is invalid',
      requestId: failedRequest.requestId,
      metrics: metrics(),
    });
    await expect(failedLoad).rejects.toThrow('checksum_mismatch');
    expect(runtime.state).toBe('ready');
    expect(runtime.diagnostics().simulationTick).toBe(4n);
    runtime.dispose();
  });

  it('routes save and load through the configured persistence adapter', async () => {
    const worker = new FakeWorker();
    const renderer = new FakeRenderer();
    const persistence = new MemoryPersistenceAdapter();
    const runtime = createFoundationRuntime({
      canvas: {} as HTMLCanvasElement,
      persistenceAdapter: persistence,
      workerFactory: () => worker,
      rendererFactory: () => renderer,
    });
    worker.emit({
      type: 'startup-ready',
      protocolVersion: 1,
      adapterVersion: 1,
      tick: 0,
      objectTypeHandles: [],
      metrics: metrics(),
    });
    await runtime.ready;

    const savePromise = runtime.saveToPersistence();
    const saveRequest = latestRequest(worker);
    if (saveRequest.type !== 'save') {
      throw new Error('expected a save request');
    }
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    worker.emit({
      type: 'save-result',
      requestId: saveRequest.requestId,
      tick: 0,
      stateHashHex: 'aa'.repeat(32),
      byteLength: bytes.byteLength,
      bytes,
      metrics: metrics(),
    });
    await savePromise;
    await expect(persistence.read()).resolves.toEqual(new Uint8Array([1, 2, 3]));

    const loadPromise = runtime.loadFromPersistence();
    await Promise.resolve();
    const loadRequest = latestRequest(worker);
    if (loadRequest.type !== 'load') {
      throw new Error('expected a load request');
    }
    worker.emit({
      type: 'load-result',
      requestId: loadRequest.requestId,
      tick: 2,
      stateHashHex: 'bb'.repeat(32),
      worldGeneration: 2,
      nextClientSequence: 4n,
      metrics: metrics(),
    });
    await expect(loadPromise).resolves.toMatchObject({ tick: 2n, worldGeneration: 2 });
    runtime.dispose();
  });

  it('registers declarative object types and routes placement queries through Rust', async () => {
    const worker = new FakeWorker();
    const renderer = new FakeRenderer();
    const runtime = createFoundationRuntime({
      canvas: {} as HTMLCanvasElement,
      objectTypes: [
        {
          id: 'foundation',
          footprint: [
            { dx: 1, dz: 0 },
            { dx: 0, dz: 0 },
          ],
        },
      ],
      workerFactory: () => worker,
      rendererFactory: () => renderer,
    });
    const initialize = worker.messages[0]?.message;
    expect(initialize).toMatchObject({ type: 'initialize', objectTypes: [{ id: 'foundation' }] });
    worker.emit({
      type: 'startup-ready',
      protocolVersion: 1,
      adapterVersion: 1,
      tick: 0,
      objectTypeHandles: [{ id: 'foundation', handle: 1 }],
      metrics: metrics(),
    });
    await runtime.ready;
    expect(runtime.objectTypeHandle('foundation')).toBe(1);

    const query = runtime.validatePlacement({
      objectType: 'foundation',
      x: 2,
      z: -1,
      elevationMm: 0,
      rotation: 0,
    });
    const request = latestPlacementRequest(worker);
    worker.emit({
      type: 'placement-validation',
      requestId: request.requestId,
      result: {
        objectType: 1,
        x: 2,
        z: -1,
        elevationMm: 0,
        rotation: 0,
        valid: true,
        occupiedCellCount: 2,
      },
      metrics: metrics(),
    });
    await expect(query).resolves.toMatchObject({
      objectType: 'foundation',
      valid: true,
      occupiedCellCount: 2,
    });
    runtime.clearPlacementPreview();
    expect(runtime.diagnostics().placementPreview).toBeUndefined();

    const placementCommand = runtime.placeObject({
      objectType: 'foundation',
      x: 2,
      z: -1,
      elevationMm: 0,
      rotation: 0,
    });
    const placementRequest = latestCommandRequest(worker);
    expect(new DataView(placementRequest.bytes).getUint16(28, true)).toBe(1);
    worker.emit({
      type: 'command-result',
      requestId: placementRequest.requestId,
      batchSequence: 1,
      tick: 1,
      stateHashHex: 'cd'.repeat(32),
      response: new ArrayBuffer(64),
      metrics: metrics(),
    });
    await placementCommand;

    const moveCommand = runtime.moveObject('0:1', {
      x: 3,
      z: -1,
      elevationMm: 0,
      rotation: 1,
    });
    const moveRequest = latestCommandRequest(worker);
    expect(new DataView(moveRequest.bytes).getUint16(28, true)).toBe(3);
    worker.emit({
      type: 'command-result',
      requestId: moveRequest.requestId,
      batchSequence: 2,
      tick: 2,
      stateHashHex: 'de'.repeat(32),
      response: new ArrayBuffer(64),
      metrics: metrics(),
    });
    await moveCommand;

    const removalCommand = runtime.removeEntity('0:1');
    const removalRequest = latestCommandRequest(worker);
    expect(new DataView(removalRequest.bytes).getUint16(28, true)).toBe(4);
    worker.emit({
      type: 'command-result',
      requestId: removalRequest.requestId,
      batchSequence: 3,
      tick: 3,
      stateHashHex: 'ef'.repeat(32),
      response: new ArrayBuffer(64),
      metrics: metrics(),
    });
    await removalCommand;
    runtime.dispose();
  });

  it('supports repeated create-ready-dispose cycles with independent owners', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const worker = new FakeWorker();
      const renderer = new FakeRenderer();
      const runtime = createFoundationRuntime({
        canvas: {} as HTMLCanvasElement,
        workerFactory: () => worker,
        rendererFactory: () => renderer,
      });
      worker.emit({
        type: 'startup-ready',
        protocolVersion: 1,
        adapterVersion: 1,
        tick: 0,
        objectTypeHandles: [],
        metrics: metrics(),
      });
      await runtime.ready;
      runtime.dispose();
      expect(worker.terminations).toBe(1);
      expect(renderer.disposals).toBe(1);
    }
  });
});
