import { init, TesseraWasm } from './wasm/tessera_wasm.js';
import {
  bytesToHex,
  DEFAULT_SCENARIO_ID,
  MAX_EXACT_TICKS_PER_CALL,
  parseWasmError,
  PROTOCOL_VERSION,
  SAVE_FRAMEWORK_VERSION,
  SAVE_GAME_ID,
  type BoundaryMetrics,
  type CommandRequest,
  type EventBatchResponse,
  type InitializeRequest,
  type MetricsRequest,
  type PlacementValidationResult,
  type RequestEventsRequest,
  type RenderEntityRecord,
  type RenderGridCell,
  type RenderSnapshotMetadata,
  type RenderSnapshotResponse,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol-types';
import { MAX_EVENT_RECORD_COUNT } from './protocol-types';

/**
 * The dedicated Worker owns the Wasm instance and both data-plane streams.
 * Rust is the single authority for the wire format; the worker passes semantic
 * JSON across the boundary and forwards decoded responses to the runtime.
 */

const workerScope = self as DedicatedWorkerGlobalScope;
let simulation: TesseraWasm | undefined;
let startupInProgress = false;
let fatal = false;
let commandCalls = 0;
let commandBytes = 0;
let eventBatches = 0;
let eventBytes = 0;
let highestAcknowledgedEvent = 0n;
let eventGapCount = 0;
let eventResyncCount = 0;
let renderSnapshots = 0;
let renderBytes = 0;
let saveCalls = 0;
let saveBytes = 0;
let loadCalls = 0;
let loadBytes = 0;
let scenarioId = DEFAULT_SCENARIO_ID;

const initializedScenarioId = (request: InitializeRequest): string =>
  request.scenarioId ?? DEFAULT_SCENARIO_ID;

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

const utf8ByteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

const metrics = (): BoundaryMetrics => ({
  commandCalls,
  commandBytes,
  eventBatches,
  eventBytes,
  highestAcknowledgedEvent: metricNumber(highestAcknowledgedEvent),
  eventGapCount,
  eventResyncCount,
  renderSnapshots,
  renderBytes,
  saveCalls,
  saveBytes,
  loadCalls,
  loadBytes,
});

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

const parseRenderSnapshotJson = (
  json: string,
  totalByteLength: number,
): Omit<RenderSnapshotResponse, 'type' | 'metrics'> => {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('tessera:snapshot:invalid_json:render snapshot is not a JSON object');
  }
  const snapshot = parsed as {
    totalByteLength: number;
    worldGeneration: number;
    snapshotGeneration: number;
    simulationTick: number;
    entityCount: number;
    entityCapacity: number;
    memoryGeneration: number;
    regions: unknown[];
    entities: RenderEntityRecord[];
    occupiedCells: RenderGridCell[];
  };
  if (snapshot.snapshotGeneration === undefined || snapshot.simulationTick === undefined) {
    throw new Error('tessera:snapshot:invalid_json:render snapshot is missing generation fields');
  }
  if (snapshot.entityCount !== snapshot.entities.length) {
    throw new Error('tessera:snapshot:invalid_json:render entity count does not match its records');
  }
  if (snapshot.regions.length === 0) {
    throw new Error('tessera:snapshot:invalid_json:render snapshot has no regions');
  }
  return {
    snapshot: {
      totalByteLength,
      worldGeneration: snapshot.worldGeneration,
      snapshotGeneration: BigInt(snapshot.snapshotGeneration),
      simulationTick: BigInt(snapshot.simulationTick),
      entityCount: snapshot.entityCount,
      entityCapacity: snapshot.entityCapacity,
      memoryGeneration: snapshot.memoryGeneration,
      regions: snapshot.regions as RenderSnapshotMetadata['regions'],
    },
    entities: snapshot.entities,
    occupiedCells: snapshot.occupiedCells,
  };
};

const publishRenderSnapshot = (): boolean => {
  if (!simulation) {
    return false;
  }
  const json = simulation.render_snapshot_json();
  const parsed = parseRenderSnapshotJson(json, utf8ByteLength(json));
  renderSnapshots += 1;
  renderBytes += utf8ByteLength(json);
  post({
    type: 'render-snapshot',
    ...parsed,
    metrics: metrics(),
  });
  return true;
};

const publishEvents = (afterSequence: bigint): void => {
  if (!simulation) {
    return;
  }
  const json = simulation.event_batch_json(afterSequence, MAX_EVENT_RECORD_COUNT);
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('tessera:events:invalid_json:event batch is not a JSON object');
  }
  const batch = parsed as {
    firstSequence: number;
    lastSequence: number;
    ackFloor: number;
    recordCount: number;
  };
  if (batch.recordCount === 0) {
    return;
  }
  const response: EventBatchResponse = {
    type: 'event-batch',
    firstSequence: BigInt(batch.firstSequence),
    lastSequence: BigInt(batch.lastSequence),
    ackFloor: BigInt(batch.ackFloor),
    recordCount: batch.recordCount,
    metrics: metrics(),
  };
  eventBatches += 1;
  eventBytes += utf8ByteLength(json);
  post(response);
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
    await init();
    simulation = new TesseraWasm(new Uint8Array(request.seed));
    scenarioId = initializedScenarioId(request);
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

const handleSave = (request: Extract<WorkerRequest, { type: 'save' }>): void => {
  if (!simulation || fatal) {
    postError(
      'command-error',
      'command',
      fatal ? 'worker_fatal' : 'not_ready',
      fatal ? 'the Worker is in a fatal state and requires restart' : 'the Worker is not ready',
      request.requestId,
    );
    return;
  }
  saveCalls += 1;
  try {
    const bytes = simulation.save_state(
      SAVE_GAME_ID,
      scenarioId,
      SAVE_FRAMEWORK_VERSION,
      PROTOCOL_VERSION,
    );
    const transfer = bytes.slice().buffer;
    saveBytes += transfer.byteLength;
    post(
      {
        type: 'save-result',
        requestId: request.requestId,
        tick: toSafeNumber(BigInt(simulation.tick()), 'save tick'),
        stateHashHex: bytesToHex(new Uint8Array(simulation.state_hash())),
        byteLength: transfer.byteLength,
        bytes: transfer,
        metrics: metrics(),
      },
      [transfer],
    );
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    postError(
      failure.type,
      failure.type === 'fatal-error' ? 'fatal' : 'command',
      failure.code,
      failure.message,
      request.requestId,
    );
  }
};

const handleLoad = (request: Extract<WorkerRequest, { type: 'load' }>): void => {
  if (!simulation || fatal) {
    postError(
      'command-error',
      'command',
      fatal ? 'worker_fatal' : 'not_ready',
      fatal ? 'the Worker is in a fatal state and requires restart' : 'the Worker is not ready',
      request.requestId,
    );
    return;
  }
  loadCalls += 1;
  loadBytes += request.bytes.byteLength;
  try {
    simulation.load_state(
      new Uint8Array(request.bytes),
      SAVE_GAME_ID,
      scenarioId,
      SAVE_FRAMEWORK_VERSION,
      PROTOCOL_VERSION,
    );
    // The Wasm adapter resets its event acknowledgement when it installs a
    // save. Keep the Worker-side cursor aligned so the first post-load batch
    // starts at sequence one rather than using the previous world's cursor.
    highestAcknowledgedEvent = 0n;
    post({
      type: 'load-result',
      requestId: request.requestId,
      tick: toSafeNumber(BigInt(simulation.tick()), 'load tick'),
      stateHashHex: bytesToHex(new Uint8Array(simulation.state_hash())),
      worldGeneration: simulation.world_generation(),
      nextClientSequence: BigInt(simulation.next_client_sequence()),
      metrics: metrics(),
    });
    publishEvents(0n);
    publishRenderSnapshot();
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    postError(
      failure.type,
      failure.type === 'fatal-error' ? 'fatal' : 'command',
      failure.code,
      failure.message,
      request.requestId,
    );
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
  commandBytes += utf8ByteLength(request.commands);
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
    const responseJson = simulation.run_command_batch_json(request.commands, request.exactTicks);
    const parsed: unknown = JSON.parse(responseJson);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('tessera:command:invalid_json:command response is not a JSON object');
    }
    const response = parsed as { batchSequence: number; tick: number; stateHashHex: string };
    post({
      type: 'command-result',
      requestId: request.requestId,
      batchSequence: toSafeNumber(BigInt(response.batchSequence), 'batch sequence'),
      tick: toSafeNumber(BigInt(response.tick), 'tick'),
      stateHashHex: response.stateHashHex,
      metrics: metrics(),
    });
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
    const responseJson = simulation.validate_placement_json(JSON.stringify(request.input));
    const parsed: unknown = JSON.parse(responseJson);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('tessera:placement:invalid_json:placement response is not a JSON object');
    }
    const result = parsed as PlacementValidationResult;
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

const requestHandlers = {
  initialize: (request: Extract<WorkerRequest, { type: 'initialize' }>) =>
    void handleInitialize(request),
  command: (request: Extract<WorkerRequest, { type: 'command' }>) => handleCommand(request),
  'validate-placement': (request: Extract<WorkerRequest, { type: 'validate-placement' }>) =>
    handlePlacementValidation(request),
  'ack-events': (request: Extract<WorkerRequest, { type: 'ack-events' }>) =>
    handleAckEvents(request),
  'request-events': (request: Extract<WorkerRequest, { type: 'request-events' }>) =>
    handleRequestEvents(request),
  metrics: (request: Extract<WorkerRequest, { type: 'metrics' }>) => handleMetrics(request),
  save: (request: Extract<WorkerRequest, { type: 'save' }>) => handleSave(request),
  load: (request: Extract<WorkerRequest, { type: 'load' }>) => handleLoad(request),
  dispose: () => handleDispose(),
} as const;

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const handler = requestHandlers[request.type] as (request: WorkerRequest) => void;
  handler(request);
});
