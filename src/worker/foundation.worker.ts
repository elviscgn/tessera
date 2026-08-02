import { init, TesseraWasm } from './wasm/tessera_wasm.js';
import {
  bytesToHex,
  decodeCommandResponse,
  decodePlacementValidation,
  MAX_EXACT_TICKS_PER_CALL,
  parseWasmError,
  PROTOCOL_VERSION,
  type BoundaryMetrics,
  type CommandRequest,
  type InitializeRequest,
  type MetricsRequest,
  type RequestEventsRequest,
  type ReturnRenderBufferRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './bridge-protocol';
import {
  decodeEventBatch,
  decodeRenderMemoryDescriptor,
  decodeRenderSnapshot,
  MAX_EVENT_RECORD_COUNT,
  patchRenderMemoryGeneration,
} from './data-protocol';
import { TransferableBufferPool } from './transfer-pool';
import { MemoryViewTracker } from './memory-views';

/**
 * The dedicated Worker owns the Wasm instance and both data-plane streams.
 * Render snapshots are copied into owned transferable buffers; authoritative
 * events are retained in Rust and published with explicit sequence ACKs.
 */

const workerScope = self as DedicatedWorkerGlobalScope;
let simulation: TesseraWasm | undefined;
let wasmMemory: WebAssembly.Memory | undefined;
let startupInProgress = false;
let fatal = false;
let bufferPool = new TransferableBufferPool(3);
let memoryViews = new MemoryViewTracker();
let commandCalls = 0;
let commandBytes = 0;
let eventBatches = 0;
let eventBytes = 0;
let highestAcknowledgedEvent = 0n;
let eventGapCount = 0;
let eventResyncCount = 0;
let renderSnapshots = 0;
let renderBytes = 0;

const post = (message: WorkerResponse, transfer: Transferable[] = []): void => {
  workerScope.postMessage(message, transfer);
};

const toSafeNumber = (value: bigint, label: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
};

const metricNumber = (value: bigint): number =>
  value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);

const metrics = (): BoundaryMetrics => {
  const pool = bufferPool.metrics();
  return {
    commandCalls,
    commandBytes,
    eventBatches,
    eventBytes,
    highestAcknowledgedEvent: metricNumber(highestAcknowledgedEvent),
    eventGapCount,
    eventResyncCount,
    renderSnapshots,
    renderBytes,
    droppedRenderSnapshots: pool.droppedSnapshots,
    inFlightRenderBuffers: pool.inFlight,
    renderBufferPoolSize: pool.capacity,
    renderBufferHighWaterMark: pool.highWaterMark,
    memoryGeneration: memoryViews.generation,
    memoryBufferBytes: memoryViews.byteLength,
    viewRecreations: memoryViews.recreations,
  };
};

const postError = (
  type: 'command-error' | 'fatal-error',
  phase: 'startup' | 'command' | 'fatal',
  code: string,
  message: string,
  requestId?: number,
): void => {
  post({
    type,
    phase,
    code,
    message,
    metrics: metrics(),
    ...(requestId === undefined ? {} : { requestId }),
  });
};

const syncMemoryViews = (): ArrayBuffer => {
  if (!wasmMemory) {
    throw new Error('tessera:startup:memory_unavailable:Wasm memory is not initialized');
  }
  return memoryViews.sync(wasmMemory);
};

const publishRenderSnapshot = (attempt = 0): boolean => {
  if (!simulation) {
    return false;
  }
  const descriptorBytes = simulation.render_snapshot_descriptor();
  const descriptor = decodeRenderMemoryDescriptor(descriptorBytes);
  const sourceBuffer = syncMemoryViews();
  const sourceEnd = descriptor.pointer + descriptor.byteLength;
  const capacityEnd = descriptor.pointer + descriptor.capacity;
  if (
    !Number.isSafeInteger(sourceEnd) ||
    !Number.isSafeInteger(capacityEnd) ||
    sourceEnd > sourceBuffer.byteLength ||
    capacityEnd > sourceBuffer.byteLength
  ) {
    throw new Error('tessera:snapshot:invalid_descriptor:Wasm snapshot exceeds memory');
  }
  const lease = bufferPool.acquire(descriptor.byteLength);
  if (!lease) {
    // A full pool is render-only backpressure. Keep simulation and event
    // delivery moving; the next returned buffer will receive a fresh snapshot.
    return false;
  }
  try {
    const source = new Uint8Array(sourceBuffer, descriptor.pointer, descriptor.byteLength);
    lease.view.set(source, 0);
    patchRenderMemoryGeneration(lease.buffer, memoryViews.generation);
    const snapshot = decodeRenderSnapshot(new Uint8Array(lease.buffer, 0, descriptor.byteLength));
    const afterBuffer = syncMemoryViews();
    if (afterBuffer !== sourceBuffer || afterBuffer.byteLength !== sourceBuffer.byteLength) {
      if (attempt < 1) {
        bufferPool.release(lease.id, lease.buffer);
        return publishRenderSnapshot(attempt + 1);
      }
      throw new Error('tessera:fatal:memory_growth:Wasm memory changed during snapshot copy');
    }
    renderSnapshots += 1;
    renderBytes += descriptor.byteLength;
    post(
      {
        type: 'render-snapshot',
        bufferId: lease.id,
        snapshotGeneration: snapshot.snapshotGeneration,
        simulationTick: snapshot.simulationTick,
        byteLength: descriptor.byteLength,
        buffer: lease.buffer,
        metrics: metrics(),
      },
      [lease.buffer],
    );
    return true;
  } catch (error: unknown) {
    bufferPool.release(lease.id, lease.buffer);
    throw error;
  }
};

const publishEvents = (afterSequence: bigint): void => {
  if (!simulation) {
    return;
  }
  const bytes = simulation.event_batch(afterSequence, MAX_EVENT_RECORD_COUNT);
  const metadata = decodeEventBatch(bytes);
  if (metadata.recordCount === 0) {
    return;
  }
  const transfer = new Uint8Array(bytes).slice().buffer;
  eventBatches += 1;
  eventBytes += transfer.byteLength;
  post(
    {
      type: 'event-batch',
      firstSequence: metadata.firstSequence,
      lastSequence: metadata.lastSequence,
      ackFloor: metadata.ackFloor,
      recordCount: metadata.recordCount,
      bytes: transfer,
      metrics: metrics(),
    },
    [transfer],
  );
};

const handleInitialize = async (request: InitializeRequest): Promise<void> => {
  if (simulation || startupInProgress || fatal) {
    postError(
      'fatal-error',
      'startup',
      fatal ? 'worker_fatal' : 'already_initialized',
      fatal
        ? 'the Worker is in a fatal state and requires restart'
        : 'the Worker has already been initialized',
    );
    return;
  }
  startupInProgress = true;
  try {
    if (request.seed.byteLength !== 32) {
      throw new Error('tessera:startup:invalid_seed:seed must be 32 bytes');
    }
    const wasm = await init();
    wasmMemory = wasm.memory;
    memoryViews = new MemoryViewTracker();
    syncMemoryViews();
    bufferPool = new TransferableBufferPool(3);
    simulation = new TesseraWasm(new Uint8Array(request.seed));
    const objectTypeHandles: Array<{ readonly id: string; readonly handle: number }> = [];
    for (const definition of request.objectTypes) {
      const handle = simulation.register_object_type(
        definition.id,
        new Int32Array(definition.footprint),
      );
      objectTypeHandles.push({ id: definition.id, handle });
    }
    post({
      type: 'startup-ready',
      protocolVersion: PROTOCOL_VERSION,
      adapterVersion: simulation.adapter_version(),
      tick: toSafeNumber(simulation.tick(), 'startup tick'),
      objectTypeHandles,
      metrics: metrics(),
    });
  } catch (error: unknown) {
    fatal = true;
    const failure = parseWasmError(error);
    postError('fatal-error', 'startup', failure.code, failure.message);
  } finally {
    startupInProgress = false;
  }
};

const handleCommand = (request: CommandRequest): void => {
  if (!simulation || fatal) {
    postError(
      'command-error',
      'command',
      fatal ? 'worker_fatal' : 'not_ready',
      fatal
        ? 'the Worker is in a fatal state and requires restart'
        : 'the Worker has not completed startup',
      request.requestId,
    );
    return;
  }
  commandCalls += 1;
  commandBytes += request.bytes.byteLength;
  if (
    !Number.isInteger(request.exactTicks) ||
    request.exactTicks < 0 ||
    request.exactTicks > MAX_EXACT_TICKS_PER_CALL
  ) {
    postError(
      'command-error',
      'command',
      'tick_bound_exceeded',
      'exact tick count must be an integer between 0 and 5',
      request.requestId,
    );
    return;
  }
  try {
    const responseBytes = simulation.run_command_batch(
      new Uint8Array(request.bytes),
      request.exactTicks,
    );
    const response = decodeCommandResponse(responseBytes);
    const responseBuffer = responseBytes.slice().buffer;
    post(
      {
        type: 'command-result',
        requestId: request.requestId,
        batchSequence: toSafeNumber(response.batchSequence, 'batch sequence'),
        tick: toSafeNumber(response.tick, 'tick'),
        stateHashHex: bytesToHex(response.stateHash),
        response: responseBuffer,
        metrics: metrics(),
      },
      [responseBuffer],
    );
    publishEvents(highestAcknowledgedEvent);
    publishRenderSnapshot();
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    if (failure.type === 'fatal-error') {
      fatal = true;
      simulation.free();
      simulation = undefined;
    }
    postError(
      failure.type,
      failure.type === 'fatal-error' ? 'fatal' : 'command',
      failure.code,
      failure.message,
      request.requestId,
    );
  }
};

const handlePlacementValidation = (
  request: Extract<WorkerRequest, { type: 'validate-placement' }>,
): void => {
  if (!simulation || fatal) {
    postError(
      'command-error',
      'command',
      fatal ? 'worker_fatal' : 'not_ready',
      fatal
        ? 'the Worker is in a fatal state and requires restart'
        : 'the Worker has not completed startup',
      request.requestId,
    );
    return;
  }
  try {
    const responseBytes = simulation.validate_placement(
      request.input.objectType,
      request.input.x,
      request.input.z,
      request.input.elevationMm,
      request.input.rotation,
    );
    const result = decodePlacementValidation(responseBytes);
    post({
      type: 'placement-validation',
      requestId: request.requestId,
      result,
      metrics: metrics(),
    });
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    if (failure.type === 'fatal-error') {
      fatal = true;
      simulation.free();
      simulation = undefined;
    }
    postError(
      failure.type,
      failure.type === 'fatal-error' ? 'fatal' : 'command',
      failure.code,
      failure.message,
      request.requestId,
    );
  }
};

const handleAckEvents = (request: Extract<WorkerRequest, { type: 'ack-events' }>): void => {
  if (!simulation || fatal) {
    postError('command-error', 'command', 'not_ready', 'the Worker is not ready');
    return;
  }
  try {
    simulation.ack_events(request.highestContiguousSequence);
    highestAcknowledgedEvent = request.highestContiguousSequence;
    post({ type: 'metrics', requestId: 0, metrics: metrics() });
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    postError('command-error', 'command', failure.code, failure.message);
  }
};

const handleRequestEvents = (request: RequestEventsRequest): void => {
  if (!simulation || fatal) {
    postError('command-error', 'command', 'not_ready', 'the Worker is not ready');
    return;
  }
  try {
    if (request.resync) {
      eventGapCount += 1;
      eventResyncCount += 1;
      publishRenderSnapshot();
    }
    publishEvents(request.afterSequence);
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    fatal = failure.type === 'fatal-error';
    postError(
      failure.type,
      failure.type === 'fatal-error' ? 'fatal' : 'command',
      failure.code,
      failure.message,
    );
  }
};

const handleReturnRenderBuffer = (request: ReturnRenderBufferRequest): void => {
  if (!bufferPool.release(request.bufferId, request.buffer)) {
    postError(
      'command-error',
      'command',
      'invalid_render_buffer',
      'the returned render buffer does not belong to the in-flight pool',
    );
    return;
  }
  post({ type: 'metrics', requestId: 0, metrics: metrics() });
};

const handleMetrics = (request: MetricsRequest): void => {
  post({ type: 'metrics', requestId: request.requestId, metrics: metrics() });
};

const handleDispose = (): void => {
  if (simulation) {
    simulation.dispose();
    simulation.free();
    simulation = undefined;
  }
  fatal = true;
  workerScope.close();
};

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'initialize') {
    void handleInitialize(request);
  } else if (request.type === 'command') {
    handleCommand(request);
  } else if (request.type === 'validate-placement') {
    handlePlacementValidation(request);
  } else if (request.type === 'ack-events') {
    handleAckEvents(request);
  } else if (request.type === 'request-events') {
    handleRequestEvents(request);
  } else if (request.type === 'return-render-buffer') {
    handleReturnRenderBuffer(request);
  } else if (request.type === 'metrics') {
    handleMetrics(request);
  } else if (request.type === 'dispose') {
    handleDispose();
  } else {
    postError('fatal-error', 'fatal', 'unknown_request', 'the Worker received an unknown request');
  }
});
