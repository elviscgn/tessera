import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  decodeCommandResponse,
  encodeSpawnCommandBatch,
  parseWasmError,
  RESPONSE_LENGTH,
} from '../../src/worker/bridge-protocol';

describe('Milestone 2A Worker bridge codec', () => {
  it('writes the versioned little-endian spawn batch', () => {
    const bytes = new Uint8Array(
      encodeSpawnCommandBatch({
        batchSequence: 1n,
        clientSequence: 1n,
        objectType: 1,
        x: 0,
        z: 0,
        elevationMm: 0,
        rotation: 0,
      }),
    );
    expect(bytes.byteLength).toBe(61);
    expect(Array.from(bytes.slice(0, 8))).toEqual([84, 83, 67, 77, 68, 48, 48, 49]);
    expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(1);
    expect(new DataView(bytes.buffer).getBigUint64(12, true)).toBe(1n);
  });

  it('decodes the fixed native/Wasm hash response', () => {
    const bytes = new Uint8Array(RESPONSE_LENGTH);
    const view = new DataView(bytes.buffer);
    bytes.set([84, 83, 82, 83, 80, 48, 48, 49], 0);
    view.setUint16(8, 1, true);
    view.setBigUint64(12, 1n, true);
    view.setBigUint64(20, 1n, true);
    bytes.set(
      [
        0x1d, 0x58, 0xe8, 0xe0, 0xcf, 0x93, 0x7e, 0x92, 0x27, 0x9a, 0x52, 0x06, 0xca, 0x3d, 0x4e,
        0x8d, 0x24, 0xb0, 0x46, 0xb9, 0x54, 0x55, 0x68, 0x69, 0x5b, 0xc2, 0x62, 0xdd, 0x0e, 0xd4,
        0x96, 0x7c,
      ],
      28,
    );
    view.setUint32(60, RESPONSE_LENGTH, true);
    const response = decodeCommandResponse(bytes);
    expect(response.batchSequence).toBe(1n);
    expect(response.tick).toBe(1n);
    expect(bytesToHex(response.stateHash)).toBe(
      '1d58e8e0cf937e92279a5206ca3d4e8d24b046b9545568695bc262dd0ed4967c',
    );
  });

  it('turns adapter failures into structured Worker errors', () => {
    expect(parseWasmError('tessera:command:invalid_magic:bad magic')).toEqual({
      type: 'command-error',
      phase: 'command',
      code: 'invalid_magic',
      message: 'bad magic',
    });
    expect(parseWasmError(new Error('unexpected failure')).type).toBe('fatal-error');
  });
});
