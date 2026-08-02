/**
 * The small control-plane codec used by the Milestone 2A Worker probe.
 *
 * Rust remains the authority for command validation and simulation state. This
 * module only writes the agreed little-endian bytes and validates the fixed
 * response returned by the Wasm adapter.
 */

export const PROTOCOL_VERSION = 1;
export const COMMAND_HEADER_LENGTH = 28;
export const RECORD_HEADER_LENGTH = 8;
export const RESPONSE_LENGTH = 64;
export const MAX_EXACT_TICKS_PER_CALL = 5;

const COMMAND_MAGIC = new Uint8Array([0x54, 0x53, 0x43, 0x4d, 0x44, 0x30, 0x30, 0x31]);
const RESPONSE_MAGIC = new Uint8Array([0x54, 0x53, 0x52, 0x53, 0x50, 0x30, 0x30, 0x31]);
const SPAWN_OPCODE = 1;

export interface SpawnCommandInput {
  readonly batchSequence: bigint;
  readonly clientSequence: bigint;
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

export interface CommandResponse {
  readonly batchSequence: bigint;
  readonly tick: bigint;
  readonly stateHash: Uint8Array;
}

export interface InitializeRequest {
  readonly type: 'initialize';
  readonly seed: Uint8Array;
}

export interface CommandRequest {
  readonly type: 'command';
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  readonly exactTicks: number;
}

export interface AckEventsRequest {
  readonly type: 'ack-events';
  readonly highestContiguousSequence: bigint;
}

export interface RequestEventsRequest {
  readonly type: 'request-events';
  readonly afterSequence: bigint;
  readonly resync: boolean;
}

export interface ReturnRenderBufferRequest {
  readonly type: 'return-render-buffer';
  readonly bufferId: number;
  readonly buffer: ArrayBuffer;
}

export interface MetricsRequest {
  readonly type: 'metrics';
  readonly requestId: number;
}

export interface DisposeRequest {
  readonly type: 'dispose';
}

export type WorkerRequest =
  | InitializeRequest
  | CommandRequest
  | AckEventsRequest
  | RequestEventsRequest
  | ReturnRenderBufferRequest
  | MetricsRequest
  | DisposeRequest;

export interface BoundaryMetrics {
  readonly commandCalls: number;
  readonly commandBytes: number;
  readonly eventBatches: number;
  readonly eventBytes: number;
  readonly highestAcknowledgedEvent: number;
  readonly eventGapCount: number;
  readonly eventResyncCount: number;
  readonly renderSnapshots: number;
  readonly renderBytes: number;
  readonly droppedRenderSnapshots: number;
  readonly inFlightRenderBuffers: number;
  readonly renderBufferPoolSize: number;
  readonly renderBufferHighWaterMark: number;
  readonly memoryGeneration: number;
  readonly memoryBufferBytes: number;
  readonly viewRecreations: number;
}

export interface StartupReadyResponse {
  readonly type: 'startup-ready';
  readonly protocolVersion: number;
  readonly adapterVersion: number;
  readonly tick: number;
  readonly metrics: BoundaryMetrics;
}

export interface CommandResultResponse {
  readonly type: 'command-result';
  readonly requestId: number;
  readonly batchSequence: number;
  readonly tick: number;
  readonly stateHashHex: string;
  readonly response: ArrayBuffer;
  readonly metrics: BoundaryMetrics;
}

export interface EventBatchResponse {
  readonly type: 'event-batch';
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly ackFloor: bigint;
  readonly recordCount: number;
  readonly bytes: ArrayBuffer;
  readonly metrics: BoundaryMetrics;
}

export interface RenderSnapshotResponse {
  readonly type: 'render-snapshot';
  readonly bufferId: number;
  readonly snapshotGeneration: bigint;
  readonly simulationTick: bigint;
  readonly byteLength: number;
  readonly buffer: ArrayBuffer;
  readonly metrics: BoundaryMetrics;
}

export interface MetricsResponse {
  readonly type: 'metrics';
  readonly requestId: number;
  readonly metrics: BoundaryMetrics;
}

export interface WorkerErrorResponse {
  readonly type: 'command-error' | 'fatal-error';
  readonly phase: 'startup' | 'command' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly requestId?: number;
  readonly metrics?: BoundaryMetrics;
}

export type WorkerResponse =
  | StartupReadyResponse
  | CommandResultResponse
  | EventBatchResponse
  | RenderSnapshotResponse
  | MetricsResponse
  | WorkerErrorResponse;

export const encodeSpawnCommandBatch = (input: SpawnCommandInput): ArrayBuffer => {
  assertU32(input.objectType, 'objectType');
  assertI32(input.x, 'x');
  assertI32(input.z, 'z');
  assertI32(input.elevationMm, 'elevationMm');
  if (!Number.isInteger(input.rotation) || input.rotation < 0 || input.rotation > 3) {
    throw new Error('rotation must be an integer in the range 0..3');
  }

  const totalLength = COMMAND_HEADER_LENGTH + RECORD_HEADER_LENGTH + 25;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  bytes.set(COMMAND_MAGIC, 0);
  view.setUint16(8, PROTOCOL_VERSION, true);
  view.setUint16(10, 0, true);
  view.setBigUint64(12, input.batchSequence, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, totalLength, true);
  view.setUint16(28, SPAWN_OPCODE, true);
  view.setUint16(30, 0, true);
  view.setUint32(32, 25, true);
  view.setBigUint64(36, input.clientSequence, true);
  view.setUint32(44, input.objectType, true);
  view.setInt32(48, input.x, true);
  view.setInt32(52, input.z, true);
  view.setInt32(56, input.elevationMm, true);
  view.setUint8(60, input.rotation);
  return bytes.buffer;
};

export const decodeCommandResponse = (input: ArrayBuffer | Uint8Array): CommandResponse => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength !== RESPONSE_LENGTH) {
    throw new Error(`response length ${bytes.byteLength} is not ${RESPONSE_LENGTH}`);
  }
  if (
    !bytes.slice(0, RESPONSE_MAGIC.length).every((value, index) => value === RESPONSE_MAGIC[index])
  ) {
    throw new Error('response magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(8, true) !== PROTOCOL_VERSION) {
    throw new Error('response protocol version is unsupported');
  }
  if (view.getUint16(10, true) !== 0) {
    throw new Error('response status is not successful');
  }
  if (view.getUint32(60, true) !== RESPONSE_LENGTH) {
    throw new Error('response total length is invalid');
  }
  return {
    batchSequence: view.getBigUint64(12, true),
    tick: view.getBigUint64(20, true),
    stateHash: bytes.slice(28, 60),
  };
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

export const parseWasmError = (error: unknown): WorkerErrorResponse => {
  const text = error instanceof Error ? error.message : String(error);
  const match = /^tessera:([^:]+):([^:]+):(.*)$/.exec(text);
  if (!match) {
    return {
      type: 'fatal-error',
      phase: 'fatal',
      code: 'unstructured_exception',
      message: text,
    };
  }
  const phase = match[1] === 'startup' || match[1] === 'command' ? match[1] : 'fatal';
  return {
    type: phase === 'command' ? 'command-error' : 'fatal-error',
    phase,
    code: match[2] ?? 'unknown_error',
    message: match[3] ?? text,
  };
};

const assertU32 = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
};

const assertI32 = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${name} must be a signed 32-bit integer`);
  }
};
