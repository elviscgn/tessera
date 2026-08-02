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
        0x24, 0xeb, 0xdf, 0xb8, 0xbf, 0x10, 0x25, 0x1c, 0x18, 0x4a, 0x2b, 0xcd, 0x57, 0xd4, 0x8a,
        0x6b, 0x7d, 0x77, 0xbe, 0x51, 0x11, 0x4f, 0xbc, 0xf7, 0x58, 0x47, 0xf7, 0x7f, 0x32, 0xad,
        0xb1, 0x04,
      ],
      28,
    );
    view.setUint32(60, RESPONSE_LENGTH, true);
    const response = decodeCommandResponse(bytes);
    expect(response.batchSequence).toBe(1n);
    expect(response.tick).toBe(1n);
    expect(bytesToHex(response.stateHash)).toBe(
      '24ebdfb8bf10251c184a2bcd57d48a6b7d77be51114fbcf75847f77f32adb104',
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
