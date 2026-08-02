import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, TesseraWasm } from '../../src/worker/wasm/tessera_wasm.js';
import {
  bytesToHex,
  decodeCommandResponse,
  encodeSpawnCommandBatch,
} from '../../src/worker/bridge-protocol';

const PROBE_HASH = '24ebdfb8bf10251c184a2bcd57d48a6b7d77be51114fbcf75847f77f32adb104';

describe('generated web-target Wasm adapter', () => {
  it('matches the native probe checkpoint through the binary boundary', () => {
    initSync({
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
    } finally {
      adapter.free();
    }
  });
});
