/**
 * The small control-plane codec used by the Milestone 2A Worker probe.
 *
 * Rust remains the authority for command validation and simulation state. This
 * module only writes the agreed little-endian bytes and validates the fixed
 * response returned by the Wasm adapter.
 */

export const PROTOCOL_VERSION = 1;
export const SAVE_GAME_ID = 'tessera';
export const SAVE_FRAMEWORK_VERSION = '0.0.0';
export const DEFAULT_SCENARIO_ID = 'default';
const COMMAND_HEADER_LENGTH = 28;
const RECORD_HEADER_LENGTH = 8;
export const RESPONSE_LENGTH = 64;
export const MAX_EXACT_TICKS_PER_CALL = 5;

const COMMAND_MAGIC = new Uint8Array([0x54, 0x53, 0x43, 0x4d, 0x44, 0x30, 0x30, 0x31]);
const RESPONSE_MAGIC = new Uint8Array([0x54, 0x53, 0x52, 0x53, 0x50, 0x30, 0x30, 0x31]);
const PLACEMENT_MAGIC = new Uint8Array([0x54, 0x53, 0x50, 0x4c, 0x43, 0x30, 0x30, 0x31]);
const SPAWN_OPCODE = 1;
const MOVE_OPCODE = 3;
const REMOVE_OPCODE = 4;
const PLACEMENT_RESPONSE_LENGTH = 40;

export interface WorkerObjectTypeDefinition {
  readonly id: string;
  /** Flat, normalized `[dx, dz, ...]` footprint offsets. */
  readonly footprint: readonly number[];
}

export interface SpawnCommandInput {
  readonly batchSequence: bigint;
  readonly clientSequence: bigint;
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

export interface MoveCommandInput {
  readonly batchSequence: bigint;
  readonly clientSequence: bigint;
  readonly slot: number;
  readonly generation: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

export interface RemoveCommandInput {
  readonly batchSequence: bigint;
  readonly clientSequence: bigint;
  readonly slot: number;
  readonly generation: number;
}

export interface PlacementValidationInput {
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

export interface PlacementValidationResponse {
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
  readonly valid: boolean;
  readonly rejectionCode?: number;
  readonly occupiedCellCount: number;
}

export interface CommandResponse {
  readonly batchSequence: bigint;
  readonly tick: bigint;
  readonly stateHash: Uint8Array;
}

export interface InitializeRequest {
  readonly type: 'initialize';
  readonly seed: Uint8Array;
  readonly objectTypes: readonly WorkerObjectTypeDefinition[];
  readonly scenarioId?: string;
}

export interface CommandRequest {
  readonly type: 'command';
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  readonly exactTicks: number;
}

export interface PlacementValidationRequest {
  readonly type: 'validate-placement';
  readonly requestId: number;
  readonly input: PlacementValidationInput;
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

export interface SaveRequest {
  readonly type: 'save';
  readonly requestId: number;
}

export interface LoadRequest {
  readonly type: 'load';
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
}

export interface DisposeRequest {
  readonly type: 'dispose';
}

export type WorkerRequest =
  | InitializeRequest
  | CommandRequest
  | PlacementValidationRequest
  | AckEventsRequest
  | RequestEventsRequest
  | ReturnRenderBufferRequest
  | MetricsRequest
  | SaveRequest
  | LoadRequest
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
  readonly saveCalls: number;
  readonly saveBytes: number;
  readonly loadCalls: number;
  readonly loadBytes: number;
}

export interface StartupReadyResponse {
  readonly type: 'startup-ready';
  readonly protocolVersion: number;
  readonly adapterVersion: number;
  readonly tick: number;
  readonly objectTypeHandles: readonly {
    readonly id: string;
    readonly handle: number;
  }[];
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

export interface PlacementValidationResponseMessage {
  readonly type: 'placement-validation';
  readonly requestId: number;
  readonly result: PlacementValidationResponse;
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

export interface SaveResultResponse {
  readonly type: 'save-result';
  readonly requestId: number;
  readonly tick: number;
  readonly stateHashHex: string;
  readonly byteLength: number;
  readonly bytes: ArrayBuffer;
  readonly metrics: BoundaryMetrics;
}

export interface LoadResultResponse {
  readonly type: 'load-result';
  readonly requestId: number;
  readonly tick: number;
  readonly stateHashHex: string;
  readonly worldGeneration: number;
  readonly nextClientSequence: bigint;
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
  | PlacementValidationResponseMessage
  | EventBatchResponse
  | RenderSnapshotResponse
  | MetricsResponse
  | SaveResultResponse
  | LoadResultResponse
  | WorkerErrorResponse;

export const encodeSpawnCommandBatch = (input: SpawnCommandInput): ArrayBuffer => {
  assertU32(input.objectType, 'objectType');
  return encodeTransformCommandBatch({
    ...input,
    opcode: SPAWN_OPCODE,
    prefixLength: 4,
    payloadWriter: (view, offset) => view.setUint32(offset, input.objectType, true),
  });
};

export const encodeMoveCommandBatch = (input: MoveCommandInput): ArrayBuffer => {
  assertEntityHandle(input.slot, input.generation);
  return encodeTransformCommandBatch({
    ...input,
    opcode: MOVE_OPCODE,
    prefixLength: 8,
    payloadWriter: (view, offset) => {
      view.setUint32(offset, input.slot, true);
      view.setUint32(offset + 4, input.generation, true);
    },
  });
};

export const encodeRemoveCommandBatch = (input: RemoveCommandInput): ArrayBuffer => {
  assertEntityHandle(input.slot, input.generation);
  const payloadLength = 16;
  const { bytes, view } = createCommandRecord(
    input.batchSequence,
    input.clientSequence,
    REMOVE_OPCODE,
    payloadLength,
  );
  view.setUint32(44, input.slot, true);
  view.setUint32(48, input.generation, true);
  return bytes.buffer;
};

const encodeTransformCommandBatch = (input: {
  readonly batchSequence: bigint;
  readonly clientSequence: bigint;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
  readonly opcode: number;
  readonly prefixLength: number;
  readonly payloadWriter: (view: DataView, offset: number) => void;
}): ArrayBuffer => {
  assertI32(input.x, 'x');
  assertI32(input.z, 'z');
  assertI32(input.elevationMm, 'elevationMm');
  assertRotation(input.rotation);
  const payloadLength = input.prefixLength + 21;
  const { bytes, view } = createCommandRecord(
    input.batchSequence,
    input.clientSequence,
    input.opcode,
    payloadLength,
  );
  input.payloadWriter(view, 44);
  const positionOffset = 44 + input.prefixLength;
  view.setInt32(positionOffset, input.x, true);
  view.setInt32(positionOffset + 4, input.z, true);
  view.setInt32(positionOffset + 8, input.elevationMm, true);
  view.setUint8(positionOffset + 12, input.rotation);
  return bytes.buffer;
};

const createCommandRecord = (
  batchSequence: bigint,
  clientSequence: bigint,
  opcode: number,
  payloadLength: number,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly view: DataView } => {
  const totalLength = COMMAND_HEADER_LENGTH + RECORD_HEADER_LENGTH + payloadLength;
  const bytes = new Uint8Array(new ArrayBuffer(totalLength));
  const view = new DataView(bytes.buffer);
  writeCommandHeader(view, bytes, batchSequence, totalLength);
  view.setUint16(COMMAND_HEADER_LENGTH, opcode, true);
  view.setUint32(COMMAND_HEADER_LENGTH + 4, payloadLength, true);
  view.setBigUint64(COMMAND_HEADER_LENGTH + RECORD_HEADER_LENGTH, clientSequence, true);
  return { bytes, view };
};

const writeCommandHeader = (
  view: DataView,
  bytes: Uint8Array,
  batchSequence: bigint,
  totalLength: number,
): void => {
  bytes.set(COMMAND_MAGIC, 0);
  view.setUint16(8, PROTOCOL_VERSION, true);
  view.setUint16(10, 0, true);
  view.setBigUint64(12, batchSequence, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, totalLength, true);
};

export const decodePlacementValidation = (
  input: ArrayBuffer | Uint8Array,
): PlacementValidationResponse => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength !== PLACEMENT_RESPONSE_LENGTH) {
    throw new Error(`placement response length ${bytes.byteLength} is invalid`);
  }
  if (
    !bytes
      .slice(0, PLACEMENT_MAGIC.length)
      .every((value, index) => value === PLACEMENT_MAGIC[index])
  ) {
    throw new Error('placement response magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(8, true) !== PROTOCOL_VERSION) {
    throw new Error('placement response protocol version is unsupported');
  }
  if (
    view.getUint16(10, true) !== 0 ||
    view.getUint32(12, true) !== PLACEMENT_RESPONSE_LENGTH ||
    view.getUint8(35) !== 0
  ) {
    throw new Error('placement response header is invalid');
  }
  const valid = view.getUint8(33);
  const rejectionCode = view.getUint8(34);
  if (valid > 1 || (valid === 1 && rejectionCode !== 0) || (valid === 0 && rejectionCode === 0)) {
    throw new Error('placement response result is invalid');
  }
  return {
    objectType: view.getUint32(16, true),
    x: view.getInt32(20, true),
    z: view.getInt32(24, true),
    elevationMm: view.getInt32(28, true),
    rotation: view.getUint8(32),
    valid: valid === 1,
    ...(rejectionCode === 0 ? {} : { rejectionCode }),
    occupiedCellCount: view.getUint32(36, true),
  };
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
  const phase =
    match[1] === 'startup'
      ? 'startup'
      : match[1] === 'command' ||
          match[1] === 'placement' ||
          match[1] === 'save' ||
          match[1] === 'load'
        ? 'command'
        : 'fatal';
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

const assertEntityHandle = (slot: number, generation: number): void => {
  assertU32(slot, 'slot');
  assertU32(generation, 'generation');
};

const assertRotation = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error('rotation must be an integer in the range 0..3');
  }
};

const assertI32 = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${name} must be a signed 32-bit integer`);
  }
};
