import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, TesseraWasm } from '../../src/worker/wasm/tessera_wasm.js';
import {
  bytesToHex,
  encodeRemoveCommandJson,
  encodeSpawnCommandJson,
} from '../../src/worker/protocol-types';

const PROBE_HASH = '1d58e8e0cf937e92279a5206ca3d4e8d24b046b9545568695bc262dd0ed4967c';

const loadAdapter = (): TesseraWasm => {
  initSync({
    module: readFileSync(new URL('../../src/worker/wasm/tessera_wasm_bg.wasm', import.meta.url)),
  });
  return new TesseraWasm(new Uint8Array(32).fill(7));
};

const parseJson = <T>(text: string): T => JSON.parse(text) as T;

interface CommandResponseJson {
  readonly batchSequence: number;
  readonly tick: number;
  readonly stateHashHex: string;
}

interface SnapshotJson {
  readonly snapshotGeneration: number;
  readonly simulationTick: number;
  readonly entityCount: number;
  readonly regions: readonly unknown[];
  readonly entities: readonly {
    readonly slot: number;
    readonly generation: number;
    readonly x: number;
    readonly z: number;
    readonly visualType: number;
  }[];
  readonly occupiedCells: readonly { x: number; z: number; elevationMm: number }[];
}

interface EventBatchJson {
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly ackFloor: number;
  readonly recordCount: number;
}

describe('generated web-target Wasm adapter', () => {
  it('matches the native probe checkpoint through the semantic JSON surface', () => {
    const adapter = loadAdapter();
    try {
      const response = parseJson<CommandResponseJson>(
        adapter.run_command_batch_json(
          encodeSpawnCommandJson({
            batchSequence: 1n,
            clientSequence: 1n,
            objectType: 1,
            x: 0,
            z: 0,
            elevationMm: 0,
            rotation: 0,
          }),
          1,
        ),
      );
      expect(response.tick).toBe(1);
      expect(response.stateHashHex).toBe(PROBE_HASH);

      const firstSnapshot = parseJson<SnapshotJson>(adapter.render_snapshot_json());
      expect(firstSnapshot.entityCount).toBe(1);
      expect(firstSnapshot.entities).toHaveLength(1);
      expect(firstSnapshot.entities[0]).toMatchObject({
        slot: 0,
        generation: 1,
        x: 0,
        z: 0,
        visualType: 1,
      });
      expect(firstSnapshot.occupiedCells).toEqual([{ x: 0, z: 0, elevationMm: 0 }]);
      expect(firstSnapshot.regions.length).toBeGreaterThan(0);

      const eventBatch = parseJson<EventBatchJson>(adapter.event_batch_json(0n, 1024));
      expect(eventBatch.firstSequence).toBe(1);
      expect(eventBatch.lastSequence).toBe(2);
      expect(eventBatch.recordCount).toBe(2);
      adapter.ack_events(BigInt(eventBatch.lastSequence));
      expect(adapter.latest_event_sequence()).toBe(BigInt(eventBatch.lastSequence));

      const secondSnapshot = parseJson<SnapshotJson>(adapter.render_snapshot_json());
      expect(secondSnapshot.snapshotGeneration).toBeGreaterThan(firstSnapshot.snapshotGeneration);
      expect(secondSnapshot.entityCount).toBe(firstSnapshot.entityCount);
    } finally {
      adapter.free();
    }
  });

  it('keeps declarative footprints and placement queries in the Rust adapter', () => {
    const adapter = loadAdapter();
    try {
      expect(adapter.register_object_type('foundation', new Int32Array([0, 0, 1, 0]))).toBe(1);
      const result = parseJson<{
        readonly objectType: number;
        readonly x: number;
        readonly z: number;
        readonly elevationMm: number;
        readonly rotation: number;
        readonly valid: boolean;
        readonly occupiedCellCount: number;
      }>(
        adapter.validate_placement_json(
          '{"objectType":1,"x":-2,"z":3,"elevationMm":250,"rotation":1}',
        ),
      );
      expect(result).toMatchObject({
        objectType: 1,
        x: -2,
        z: 3,
        elevationMm: 250,
        rotation: 1,
        valid: true,
        occupiedCellCount: 2,
      });
    } finally {
      adapter.free();
    }
  });

  it('rejects a malformed JSON command batch through the adapter', () => {
    const adapter = loadAdapter();
    try {
      expect(() => adapter.run_command_batch_json('{"batchSequence":1,"commands":[]', 1)).toThrow(
        'tessera:command:json:',
      );
    } finally {
      adapter.free();
    }
  });

  it('removal commands round-trip through the JSON surface', () => {
    const adapter = loadAdapter();
    try {
      adapter.run_command_batch_json(
        encodeSpawnCommandJson({
          batchSequence: 1n,
          clientSequence: 1n,
          objectType: 1,
          x: 4,
          z: 6,
          elevationMm: 0,
          rotation: 0,
        }),
        1,
      );
      const response = parseJson<CommandResponseJson>(
        adapter.run_command_batch_json(
          encodeRemoveCommandJson({
            batchSequence: 2n,
            clientSequence: 2n,
            slot: 0,
            generation: 1,
          }),
          1,
        ),
      );
      expect(response.batchSequence).toBe(2);
      expect(response.stateHashHex).toHaveLength(64);
      const snapshot = parseJson<SnapshotJson>(adapter.render_snapshot_json());
      expect(snapshot.entityCount).toBe(0);
    } finally {
      adapter.free();
    }
  });

  it('exposes the probe state hash as hex', () => {
    const adapter = loadAdapter();
    try {
      adapter.run_command_batch_json(
        encodeSpawnCommandJson({
          batchSequence: 1n,
          clientSequence: 1n,
          objectType: 1,
          x: 0,
          z: 0,
          elevationMm: 0,
          rotation: 0,
        }),
        1,
      );
      expect(bytesToHex(new Uint8Array(adapter.state_hash()))).toBe(PROBE_HASH);
    } finally {
      adapter.free();
    }
  });
});
