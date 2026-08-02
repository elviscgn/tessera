/**
 * A small ownership-tracked pool for render-only transferable buffers.
 *
 * Pool exhaustion is intentionally a visual backpressure result. The caller
 * must drop that snapshot and continue simulation/event work instead of
 * waiting or reusing a buffer still owned by the main thread.
 */

export interface RenderBufferLease {
  readonly id: number;
  readonly buffer: ArrayBuffer;
  readonly view: Uint8Array;
  readonly capacity: number;
}

export interface TransferPoolMetrics {
  readonly capacity: number;
  readonly inFlight: number;
  readonly highWaterMark: number;
  readonly allocatedBytes: number;
  readonly droppedSnapshots: number;
  readonly invalidReturns: number;
}

interface BufferSlot {
  readonly id: number;
  buffer: ArrayBuffer | undefined;
  capacity: number;
  inFlight: boolean;
}

const nextPowerOfTwo = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('buffer size must be a positive safe integer');
  }
  let result = 1;
  while (result < value) {
    result *= 2;
    if (!Number.isSafeInteger(result)) {
      throw new Error('buffer size exceeds the safe integer range');
    }
  }
  return result;
};

export class TransferableBufferPool {
  private readonly slots: BufferSlot[];
  private inFlight = 0;
  private highWaterMark = 0;
  private allocatedBytes = 0;
  private droppedSnapshots = 0;
  private invalidReturns = 0;

  public constructor(slotCount = 3) {
    if (!Number.isInteger(slotCount) || slotCount < 1) {
      throw new Error('transfer pool slot count must be positive');
    }
    this.slots = Array.from({ length: slotCount }, (_, id) => ({
      id,
      buffer: undefined,
      capacity: 0,
      inFlight: false,
    }));
  }

  public acquire(byteLength: number): RenderBufferLease | undefined {
    const slot = this.slots.find((candidate) => !candidate.inFlight);
    if (!slot) {
      this.droppedSnapshots += 1;
      return undefined;
    }
    const capacity = nextPowerOfTwo(Math.max(1, byteLength));
    if (!slot.buffer || slot.capacity < capacity || slot.buffer.byteLength === 0) {
      this.allocatedBytes -= slot.capacity;
      slot.buffer = new ArrayBuffer(capacity);
      slot.capacity = capacity;
      this.allocatedBytes += capacity;
    }
    slot.inFlight = true;
    this.inFlight += 1;
    this.highWaterMark = Math.max(this.highWaterMark, this.inFlight);
    return {
      id: slot.id,
      buffer: slot.buffer,
      view: new Uint8Array(slot.buffer),
      capacity: slot.capacity,
    };
  }

  public release(id: number, buffer: ArrayBuffer): boolean {
    const slot = this.slots[id];
    if (!slot || !slot.inFlight || buffer.byteLength < slot.capacity) {
      this.invalidReturns += 1;
      return false;
    }
    slot.buffer = buffer;
    slot.inFlight = false;
    this.inFlight -= 1;
    return true;
  }

  public metrics(): TransferPoolMetrics {
    return {
      capacity: this.slots.length,
      inFlight: this.inFlight,
      highWaterMark: this.highWaterMark,
      allocatedBytes: this.allocatedBytes,
      droppedSnapshots: this.droppedSnapshots,
      invalidReturns: this.invalidReturns,
    };
  }
}
