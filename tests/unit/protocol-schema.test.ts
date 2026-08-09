import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  encodeEmptyCommandJson,
  encodeMoveCommandJson,
  encodeRemoveCommandJson,
  encodeSpawnCommandJson,
  parseWasmError,
} from '../../src/worker/protocol-types';
import type { CommandResultData, PlacementValidationResult } from '../../src/worker/protocol-types';

const parseJson = <T>(text: string): T => JSON.parse(text) as T;

describe('Milestone 2A semantic protocol helpers', () => {
  it('encodes an empty batch for an exact clock step', () => {
    const document = parseJson<{ batchSequence: number; commands: readonly unknown[] }>(
      encodeEmptyCommandJson(),
    );
    expect(document).toEqual({ batchSequence: 0, commands: [] });
    expect(encodeEmptyCommandJson(4n)).toBe('{"batchSequence":4,"commands":[]}');
  });

  it('writes the spawn batch JSON document', () => {
    const document = parseJson<{
      batchSequence: number;
      commands: readonly { kind: string; payload: Record<string, number> }[];
    }>(
      encodeSpawnCommandJson({
        batchSequence: 1n,
        clientSequence: 1n,
        objectType: 1,
        x: 0,
        z: -3,
        elevationMm: 250,
        rotation: 3,
      }),
    );
    expect(document).toEqual({
      batchSequence: 1,
      commands: [
        {
          kind: 'spawn',
          payload: {
            clientSequence: 1,
            objectType: 1,
            x: 0,
            z: -3,
            elevationMm: 250,
            rotation: 3,
          },
        },
      ],
    });
  });

  it('encodes move and remove records with their complete payloads', () => {
    const move = parseJson<{
      batchSequence: number;
      commands: readonly { kind: string; payload: Record<string, number> }[];
    }>(
      encodeMoveCommandJson({
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
    expect(move).toEqual({
      batchSequence: 2,
      commands: [
        {
          kind: 'move',
          payload: {
            clientSequence: 3,
            slot: 4,
            generation: 5,
            x: -2,
            z: 8,
            elevationMm: 250,
            rotation: 3,
          },
        },
      ],
    });

    const remove = parseJson<{
      batchSequence: number;
      commands: readonly { kind: string; payload: Record<string, number> }[];
    }>(
      encodeRemoveCommandJson({
        batchSequence: 4n,
        clientSequence: 5n,
        slot: 4,
        generation: 6,
      }),
    );
    expect(remove).toEqual({
      batchSequence: 4,
      commands: [{ kind: 'remove', payload: { clientSequence: 5, slot: 4, generation: 6 } }],
    });
  });

  it('turns adapter failures into structured Worker errors', () => {
    expect(parseWasmError('tessera:command:invalid_magic:bad magic')).toEqual({
      type: 'command-error',
      code: 'invalid_magic',
      message: 'bad magic',
    });
    expect(parseWasmError('tessera:fatal:wasm_trap:unreachable')).toEqual({
      type: 'fatal-error',
      code: 'wasm_trap',
      message: 'unreachable',
    });
    expect(parseWasmError(new Error('unexpected failure')).type).toBe('fatal-error');
  });

  it('hex-encodes hash bytes used in command responses', () => {
    expect(bytesToHex(new Uint8Array([0x1d, 0x58, 0xe8, 0xe0]))).toBe('1d58e8e0');
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });

  it('matches the authoritative placement response JSON contract', () => {
    const result: PlacementValidationResult = {
      objectType: 2,
      x: -1,
      z: 3,
      elevationMm: 250,
      rotation: 1,
      valid: false,
      rejectionCode: 7,
      occupiedCellCount: 1,
    };
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

  it('accepts the command response JSON contract', () => {
    const response: CommandResultData = {
      batchSequence: 9,
      tick: 20,
      stateHashHex: 'ab'.repeat(32),
    };
    expect(response).toEqual({ batchSequence: 9, tick: 20, stateHashHex: 'ab'.repeat(32) });
  });
});
