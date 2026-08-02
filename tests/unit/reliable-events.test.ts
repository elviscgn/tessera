import { describe, expect, it } from 'vitest';
import { ReliableEventReceiver } from '../../src/worker/reliable-events';

const batch = (firstSequence: bigint, lastSequence: bigint, recordCount: number) => ({
  firstSequence,
  lastSequence,
  ackFloor: 0n,
  recordCount,
});

describe('reliable event receiver', () => {
  it('does not acknowledge across a gap and recovers from the last checkpoint', () => {
    const receiver = new ReliableEventReceiver();
    expect(receiver.accept(batch(2n, 2n, 1)).type).toBe('gap');
    expect(receiver.metrics()).toMatchObject({
      highestContiguousSequence: 0n,
      gapCount: 1,
      desynced: true,
    });
    expect(receiver.requestResync()).toBe(0n);
    expect(receiver.accept(batch(1n, 2n, 2)).type).toBe('accepted');
    expect(receiver.metrics()).toMatchObject({
      highestContiguousSequence: 2n,
      resyncCount: 1,
      desynced: false,
    });
  });

  it('deduplicates already acknowledged batches', () => {
    const receiver = new ReliableEventReceiver();
    expect(receiver.accept(batch(1n, 1n, 1)).type).toBe('accepted');
    expect(receiver.accept(batch(1n, 1n, 1)).type).toBe('duplicate');
    expect(receiver.metrics().duplicateBatchCount).toBe(1);
  });
});
