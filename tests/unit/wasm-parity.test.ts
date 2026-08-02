import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, TesseraWasm } from '../../src/worker/wasm/tessera_wasm.js';
import {
  bytesToHex,
  decodeCommandResponse,
  encodeSpawnCommandBatch,
} from '../../src/worker/bridge-protocol';
import {
  decodeOccupiedCells,
  decodeEventBatch,
  decodeRenderEntities,
  decodeRenderMemoryDescriptor,
  decodeRenderSnapshot,
} from '../../src/worker/data-protocol';

const PROBE_HASH = '1d58e8e0cf937e92279a5206ca3d4e8d24b046b9545568695bc262dd0ed4967c';

describe('generated web-target Wasm adapter', () => {
  it('matches the native probe checkpoint through the binary boundary', () => {
    const wasm = initSync({
      module: readFileSync(new URL('../../src/worker/wasm/tessera_wasm_bg.wasm', import.meta.url)),
    });
    const adapter = new TesseraWasm(new Uint8Array(32).fill(7));
    try {
      const response = decodeCommandResponse(
        adapter.run_command_batch(
          new Uint8Array(
            encodeSpawnCommandBatch({
              batchSequence: 1n,
              clientSequence: 1n,
              objectType: 1,
              x: 0,
              z: 0,
              elevationMm: 0,
              rotation: 0,
            }),
          ),
          1,
        ),
      );
      expect(response.tick).toBe(1n);
      expect(bytesToHex(response.stateHash)).toBe(PROBE_HASH);

      const firstDescriptor = decodeRenderMemoryDescriptor(adapter.render_snapshot_descriptor());
      const firstMemoryBuffer = wasm.memory.buffer;
      const firstSnapshot = decodeRenderSnapshot(
        new Uint8Array(firstMemoryBuffer, firstDescriptor.pointer, firstDescriptor.byteLength),
      );
      expect(firstSnapshot.entityCount).toBe(1);
      expect(firstSnapshot.snapshotGeneration).toBe(firstDescriptor.snapshotGeneration);
      expect(firstSnapshot.memoryGeneration).toBe(0);
      expect(firstSnapshot.regions).toHaveLength(10);
      expect(
        decodeOccupiedCells(
          new Uint8Array(firstMemoryBuffer, firstDescriptor.pointer, firstDescriptor.byteLength),
          firstSnapshot,
        ),
      ).toEqual([{ x: 0, z: 0, elevationMm: 0 }]);
      expect(
        decodeRenderEntities(
          new Uint8Array(firstMemoryBuffer, firstDescriptor.pointer, firstDescriptor.byteLength),
          firstSnapshot,
        ),
      ).toMatchObject([{ slot: 0, generation: 1, x: 0, z: 0, visualType: 1 }]);

      const eventBatch = decodeEventBatch(adapter.event_batch(0n, 1024));
      expect(eventBatch.firstSequence).toBe(1n);
      expect(eventBatch.lastSequence).toBe(2n);
      expect(eventBatch.recordCount).toBe(2);
      adapter.ack_events(eventBatch.lastSequence);
      expect(adapter.latest_event_sequence()).toBe(eventBatch.lastSequence);

      wasm.memory.grow(1);
      expect(wasm.memory.buffer).not.toBe(firstMemoryBuffer);
      const secondDescriptor = decodeRenderMemoryDescriptor(adapter.render_snapshot_descriptor());
      const secondSnapshot = decodeRenderSnapshot(
        new Uint8Array(wasm.memory.buffer, secondDescriptor.pointer, secondDescriptor.byteLength),
      );
      expect(secondSnapshot.snapshotGeneration).toBeGreaterThan(firstSnapshot.snapshotGeneration);
      expect(secondSnapshot.entityCount).toBe(firstSnapshot.entityCount);
    } finally {
      adapter.free();
    }
  });
});
