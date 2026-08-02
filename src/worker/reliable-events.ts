import type { EventBatchMetadata } from './data-protocol';

export interface EventStreamMetrics {
  readonly highestContiguousSequence: bigint;
  readonly gapCount: number;
  readonly resyncCount: number;
  readonly duplicateBatchCount: number;
  readonly desynced: boolean;
}

export type EventBatchResult =
  | {
      readonly type: 'accepted';
      readonly highestContiguousSequence: bigint;
    }
  | {
      readonly type: 'duplicate';
      readonly highestContiguousSequence: bigint;
    }
  | {
      readonly type: 'gap';
      readonly expectedSequence: bigint;
      readonly receivedSequence: bigint;
    };

/**
 * Main-thread reliability state for authoritative event batches.
 *
 * It accepts only contiguous sequences, never advances an acknowledgement
 * across a gap, and requests resynchronization from the last known checkpoint.
 */
export class ReliableEventReceiver {
  private highestContiguousSequence = 0n;
  private gapCount = 0;
  private resyncCount = 0;
  private duplicateBatchCount = 0;
  private desynced = false;

  public accept(batch: EventBatchMetadata): EventBatchResult {
    if (batch.recordCount === 0) {
      return {
        type: 'duplicate',
        highestContiguousSequence: this.highestContiguousSequence,
      };
    }
    const expected = this.highestContiguousSequence + 1n;
    if (batch.firstSequence > expected) {
      this.gapCount += 1;
      this.desynced = true;
      return {
        type: 'gap',
        expectedSequence: expected,
        receivedSequence: batch.firstSequence,
      };
    }
    if (batch.lastSequence <= this.highestContiguousSequence) {
      this.duplicateBatchCount += 1;
      return {
        type: 'duplicate',
        highestContiguousSequence: this.highestContiguousSequence,
      };
    }
    this.highestContiguousSequence = batch.lastSequence;
    this.desynced = false;
    return {
      type: 'accepted',
      highestContiguousSequence: this.highestContiguousSequence,
    };
  }

  public requestResync(): bigint {
    this.resyncCount += 1;
    this.desynced = true;
    return this.highestContiguousSequence;
  }

  public metrics(): EventStreamMetrics {
    return {
      highestContiguousSequence: this.highestContiguousSequence,
      gapCount: this.gapCount,
      resyncCount: this.resyncCount,
      duplicateBatchCount: this.duplicateBatchCount,
      desynced: this.desynced,
    };
  }
}
