/**
 * The semantic protocol shared across the Worker boundary (M22).
 *
 * Rust is the single authority for the binary wire format. The host never
 * mirrors it: commands cross the boundary as semantic JSON that the Wasm
 * adapter encodes, and every response returns as decoded JSON. This module
 * carries only the stable contracts plus the tiny JSON builders that shape
 * semantic commands; it contains no byte codecs.
 */

export const PROTOCOL_VERSION = 1;
export const SAVE_GAME_ID = 'tessera';
export const SAVE_FRAMEWORK_VERSION = '0.0.0';
export const DEFAULT_SCENARIO_ID = 'default';
export const MAX_EXACT_TICKS_PER_CALL = 5;
export const MAX_EVENT_RECORD_COUNT = 1024;

export interface WorkerObjectTypeDefinition {
  readonly id: string;
  /** Flat, normalized `[dx, dz, ...]` footprint offsets. */
  readonly footprint: readonly number[];
}

/** Semantic JSON form of one spawn command record. */
export interface SpawnCommandJson {
  readonly kind: 'spawn';
  readonly payload: {
    readonly clientSequence: bigint;
    readonly objectType: number;
    readonly x: number;
    readonly z: number;
    readonly elevationMm: number;
    readonly rotation: number;
  };
}

/** Semantic JSON form of one move command record. */
export interface MoveCommandJson {
  readonly kind: 'move';
  readonly payload: {
    readonly clientSequence: bigint;
    readonly slot: number;
    readonly generation: number;
    readonly x: number;
    readonly z: number;
    readonly elevationMm: number;
    readonly rotation: number;
  };
}

/** Semantic JSON form of one removal command record. */
export interface RemoveCommandJson {
  readonly kind: 'remove';
  readonly payload: {
    readonly clientSequence: bigint;
    readonly slot: number;
    readonly generation: number;
  };
}

export type CommandDocument = SpawnCommandJson | MoveCommandJson | RemoveCommandJson;

export type CommandJson = CommandDocument;

export interface CommandBatchJson {
  readonly batchSequence: bigint;
  readonly commands: readonly CommandJson[];
}

export interface PlacementValidationInputJson {
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

export interface PlacementValidationResult {
  readonly objectType: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
  readonly valid: boolean;
  readonly rejectionCode?: number;
  readonly occupiedCellCount: number;
}

export interface CommandResultData {
  readonly batchSequence: number;
  readonly tick: number;
  readonly stateHashHex: string;
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
  /** Semantic JSON batch produced by the host runtime. */
  readonly commands: string;
  readonly exactTicks: number;
}

export interface PlacementValidationRequest {
  readonly type: 'validate-placement';
  readonly requestId: number;
  readonly input: PlacementValidationInputJson;
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
  readonly metrics: BoundaryMetrics;
}

export interface PlacementValidationResponseMessage {
  readonly type: 'placement-validation';
  readonly requestId: number;
  readonly result: PlacementValidationResult;
  readonly metrics: BoundaryMetrics;
}

export interface EventBatchResponse {
  readonly type: 'event-batch';
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly ackFloor: bigint;
  readonly recordCount: number;
  readonly metrics: BoundaryMetrics;
}

export interface EventBatchMetadata {
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly ackFloor: bigint;
  readonly recordCount: number;
}

export interface RenderRegionMetadata {
  readonly kind: number;
  readonly scalarType: number;
  readonly componentCount: number;
  readonly flags: number;
  readonly offset: number;
  readonly elementCount: number;
  readonly byteLength: number;
  readonly capacity: number;
}

export interface RenderSnapshotMetadata {
  readonly totalByteLength: number;
  readonly worldGeneration: number;
  readonly snapshotGeneration: bigint;
  readonly simulationTick: bigint;
  readonly entityCount: number;
  readonly entityCapacity: number;
  readonly memoryGeneration: number;
  readonly regions: readonly RenderRegionMetadata[];
}

export interface RenderGridCell {
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
}

export interface RenderEntityRecord {
  readonly slot: number;
  readonly generation: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
  readonly scale: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly visualType: number;
  readonly renderFlags: number;
}

export interface RenderSnapshotResponse {
  readonly type: 'render-snapshot';
  readonly snapshot: RenderSnapshotMetadata;
  readonly entities: readonly RenderEntityRecord[];
  readonly occupiedCells: readonly RenderGridCell[];
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

export const bytesToHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
};

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

export const encodeSpawnCommandJson = (input: SpawnCommandInput): string =>
  JSON.stringify({
    batchSequence: Number(input.batchSequence),
    commands: [
      {
        kind: 'spawn',
        payload: {
          clientSequence: Number(input.clientSequence),
          objectType: input.objectType,
          x: input.x,
          z: input.z,
          elevationMm: input.elevationMm,
          rotation: input.rotation,
        },
      },
    ],
  });

export const encodeMoveCommandJson = (input: MoveCommandInput): string =>
  JSON.stringify({
    batchSequence: Number(input.batchSequence),
    commands: [
      {
        kind: 'move',
        payload: {
          clientSequence: Number(input.clientSequence),
          slot: input.slot,
          generation: input.generation,
          x: input.x,
          z: input.z,
          elevationMm: input.elevationMm,
          rotation: input.rotation,
        },
      },
    ],
  });

export const encodeRemoveCommandJson = (input: RemoveCommandInput): string =>
  JSON.stringify({
    batchSequence: Number(input.batchSequence),
    commands: [
      {
        kind: 'remove',
        payload: {
          clientSequence: Number(input.clientSequence),
          slot: input.slot,
          generation: input.generation,
        },
      },
    ],
  });

export const encodeEmptyCommandJson = (batchSequence?: bigint): string =>
  JSON.stringify({
    batchSequence: batchSequence === undefined ? 0 : Number(batchSequence),
    commands: [],
  });

export interface WasmError {
  readonly type: 'command-error' | 'fatal-error';
  readonly code: string;
  readonly message: string;
}

export const parseWasmError = (error: unknown): WasmError => {
  const text = error instanceof Error ? error.message : String(error);
  const match = /^tessera:([a-z_]+):([a-z_]+):(.*)$/su.exec(text);
  const phase = match?.[1];
  const code = match?.[2];
  const message = match?.[3];
  if (phase === undefined || code === undefined || message === undefined) {
    return {
      type: 'fatal-error',
      code: 'adapter',
      message: text,
    };
  }
  return {
    type: phase === 'fatal' ? 'fatal-error' : 'command-error',
    code,
    message,
  };
};
