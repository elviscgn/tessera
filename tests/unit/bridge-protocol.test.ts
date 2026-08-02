import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  decodeCommandResponse,
  decodePlacementValidation,
  encodeMoveCommandBatch,
  encodeRemoveCommandBatch,
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

  it('encodes move and remove records with their complete payloads', () => {
    const move = new Uint8Array(
      encodeMoveCommandBatch({
        batchSequence: 2n,
        clientSequence: 3n,
        slot: 4,
        generation: 5,
        x: -2,
        z: 8,
        elevationMm: 250,
        rotation: 3,
      }),
    );
    expect(move.byteLength).toBe(65);
    expect(new DataView(move.buffer).getUint16(28, true)).toBe(3);
    expect(new DataView(move.buffer).getUint32(44, true)).toBe(4);
    expect(new DataView(move.buffer).getUint32(48, true)).toBe(5);
    expect(new DataView(move.buffer).getInt32(52, true)).toBe(-2);

    const remove = new Uint8Array(
      encodeRemoveCommandBatch({
        batchSequence: 4n,
        clientSequence: 5n,
        slot: 4,
        generation: 6,
      }),
    );
    expect(remove.byteLength).toBe(52);
    expect(new DataView(remove.buffer).getUint16(28, true)).toBe(4);
    expect(new DataView(remove.buffer).getUint32(44, true)).toBe(4);
    expect(new DataView(remove.buffer).getUint32(48, true)).toBe(6);
  });

  it('decodes an authoritative placement response and preserves rejection codes', () => {
    const bytes = new Uint8Array(40);
    bytes.set([84, 83, 80, 76, 67, 48, 48, 49]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, 1, true);
    view.setUint32(12, 40, true);
    view.setUint32(16, 2, true);
    view.setInt32(20, -1, true);
    view.setInt32(24, 3, true);
    view.setInt32(28, 250, true);
    view.setUint8(32, 1);
    view.setUint8(33, 0);
    view.setUint8(34, 7);
    const result = decodePlacementValidation(bytes);
    expect(result).toMatchObject({
      objectType: 2,
      x: -1,
      z: 3,
      elevationMm: 250,
      rotation: 1,
      valid: false,
      rejectionCode: 7,
    });
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
