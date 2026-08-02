import { describe, expect, it } from 'vitest';
import { TransferableBufferPool } from '../../src/worker/transfer-pool';

describe('render transferable buffer pool', () => {
  it('drops only when every render buffer is in flight', () => {
    const pool = new TransferableBufferPool(2);
    const first = pool.acquire(17);
    const second = pool.acquire(33);
    expect(first?.capacity).toBe(32);
    expect(second?.capacity).toBe(64);
    expect(pool.acquire(1)).toBeUndefined();
    expect(pool.metrics()).toMatchObject({
      inFlight: 2,
      droppedSnapshots: 1,
      highWaterMark: 2,
    });

    expect(first).toBeDefined();
    expect(pool.release(first?.id ?? -1, first?.buffer ?? new ArrayBuffer(0))).toBe(true);
    const reused = pool.acquire(16);
    expect(reused?.id).toBe(first?.id);
    expect(reused?.capacity).toBe(32);
  });

  it('rejects an invalid return without changing in-flight ownership', () => {
    const pool = new TransferableBufferPool(1);
    const lease = pool.acquire(8);
    expect(lease).toBeDefined();
    expect(pool.release(lease?.id ?? -1, new ArrayBuffer(1))).toBe(false);
    expect(pool.metrics()).toMatchObject({ inFlight: 1, invalidReturns: 1 });
  });
});
