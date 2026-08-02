import { describe, expect, it } from 'vitest';
import { decodeEventBatch, decodeRenderSnapshot } from '../../src/worker/data-protocol';

describe('packed data-plane validation', () => {
  it('accepts an empty reliable event batch only with zero sequence metadata', () => {
    const bytes = new Uint8Array(48);
    bytes.set([84, 83, 69, 86, 84, 48, 48, 49]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, 1, true);
    view.setUint32(12, 48, true);
    expect(decodeEventBatch(bytes)).toMatchObject({
      firstSequence: 0n,
      lastSequence: 0n,
      recordCount: 0,
    });
  });

  it('rejects a render region that overlaps the descriptor table', () => {
    const bytes = new Uint8Array(64 + 32);
    bytes.set([84, 83, 82, 78, 68, 48, 48, 49]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, 1, true);
    view.setUint16(10, 64, true);
    view.setUint32(16, bytes.byteLength, true);
    view.setUint32(40, 1, true);
    view.setUint32(44, 1, true);
    view.setUint16(52, 1, true);
    view.setUint16(54, 32, true);
    view.setUint32(56, 64, true);
    view.setUint16(64, 1, true);
    view.setUint8(66, 3);
    view.setUint8(67, 1);
    view.setUint32(72, 64, true);
    view.setUint32(76, 1, true);
    view.setUint32(80, 4, true);
    view.setUint32(84, 4, true);
    expect(() => decodeRenderSnapshot(bytes)).toThrow(/overlaps the descriptor table/u);
  });

  it('rejects duplicate render region kinds before a decoder chooses one', () => {
    const bytes = new Uint8Array(64 + 64);
    bytes.set([84, 83, 82, 78, 68, 48, 48, 49]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, 1, true);
    view.setUint16(10, 64, true);
    view.setUint32(16, bytes.byteLength, true);
    view.setUint32(40, 0, true);
    view.setUint32(44, 0, true);
    view.setUint16(52, 2, true);
    view.setUint16(54, 32, true);
    view.setUint32(56, 64, true);
    for (const offset of [64, 96]) {
      view.setUint16(offset, 1, true);
      view.setUint8(offset + 2, 3);
      view.setUint8(offset + 3, 1);
      view.setUint32(offset + 8, 128, true);
    }
    expect(() => decodeRenderSnapshot(bytes)).toThrow(/region kind 1 is duplicated/u);
  });
});
