import { describe, expect, it } from 'vitest';
import {
  createFoundationRuntime,
  type FoundationRenderer,
  type FoundationWorker,
} from '../../src/browser/foundation-runtime';
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
        metrics: metrics(),
      });
      await runtime.ready;
      runtime.dispose();
      expect(worker.terminations).toBe(1);
      expect(renderer.disposals).toBe(1);
    }
  });
});
