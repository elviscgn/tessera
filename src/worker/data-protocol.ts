/**
 * Validation for the packed render and reliable-event data planes.
 *
 * These functions never create gameplay objects. They validate bounds,
 * generations, region descriptors, and event sequence continuity before a
 * caller exposes bytes to a renderer or acknowledges authoritative events.
 */

export const RENDER_HEADER_LENGTH = 64;
export const RENDER_REGION_DESCRIPTOR_LENGTH = 32;
export const RENDER_DESCRIPTOR_LENGTH = 32;
export const EVENT_HEADER_LENGTH = 48;
export const EVENT_RECORD_HEADER_LENGTH = 8;
export const MAX_EVENT_RECORD_COUNT = 1024;
export const MAX_EVENT_BATCH_BYTES = 1024 * 1024;

const PROTOCOL_VERSION = 1;
const RENDER_MAGIC = new Uint8Array([0x54, 0x53, 0x52, 0x4e, 0x44, 0x30, 0x30, 0x31]);
const RENDER_DESCRIPTOR_MAGIC = new Uint8Array([0x54, 0x53, 0x44, 0x45, 0x53, 0x30, 0x30, 0x31]);
const EVENT_MAGIC = new Uint8Array([0x54, 0x53, 0x45, 0x56, 0x54, 0x30, 0x30, 0x31]);

const scalarWidth = (scalarType: number): number => {
  switch (scalarType) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
    case 4:
    case 5:
      return 4;
    default:
      throw new Error(`render scalar type ${scalarType} is unsupported`);
  }
};

const asBytes = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

const equalMagic = (bytes: Uint8Array, magic: Uint8Array): boolean =>
  magic.every((value, index) => bytes[index] === value);

const checkedEnd = (offset: number, length: number, total: number, label: string): number => {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || offset < 0 || length < 0 || end > total) {
    throw new Error(`${label} exceeds its transport buffer`);
  }
  return end;
};

export interface RenderMemoryDescriptor {
  readonly pointer: number;
  readonly byteLength: number;
  readonly capacity: number;
  readonly snapshotGeneration: bigint;
}

export interface RenderRegionMetadata {
  readonly kind: number;
  readonly scalarType: number;
  readonly componentCount: number;
  readonly flags: number;
  readonly offset: number;
  readonly elementCount: number;
  readonly byteLength: number;
  readonly capacity: number;
}

export interface RenderSnapshotMetadata {
  readonly totalByteLength: number;
  readonly worldGeneration: number;
  readonly snapshotGeneration: bigint;
  readonly simulationTick: bigint;
  readonly entityCount: number;
  readonly entityCapacity: number;
  readonly memoryGeneration: number;
  readonly regions: readonly RenderRegionMetadata[];
}

export const decodeRenderMemoryDescriptor = (
  input: ArrayBuffer | Uint8Array,
): RenderMemoryDescriptor => {
  const bytes = asBytes(input);
  if (bytes.byteLength !== RENDER_DESCRIPTOR_LENGTH) {
    throw new Error(`render descriptor length ${bytes.byteLength} is invalid`);
  }
  if (!equalMagic(bytes, RENDER_DESCRIPTOR_MAGIC)) {
    throw new Error('render descriptor magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(8, true) !== PROTOCOL_VERSION) {
    throw new Error('render descriptor protocol version is unsupported');
  }
  if (view.getUint16(10, true) !== RENDER_DESCRIPTOR_LENGTH) {
    throw new Error('render descriptor header length is invalid');
  }
  const byteLength = view.getUint32(16, true);
  const capacity = view.getUint32(20, true);
  if (byteLength > capacity) {
    throw new Error('render descriptor byte length exceeds capacity');
  }
  return {
    pointer: view.getUint32(12, true),
    byteLength,
    capacity,
    snapshotGeneration: view.getBigUint64(24, true),
  };
};

export const decodeRenderSnapshot = (input: ArrayBuffer | Uint8Array): RenderSnapshotMetadata => {
  const bytes = asBytes(input);
  if (bytes.byteLength < RENDER_HEADER_LENGTH) {
    throw new Error('render snapshot is truncated');
  }
  if (!equalMagic(bytes, RENDER_MAGIC)) {
    throw new Error('render snapshot magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(8, true) !== PROTOCOL_VERSION) {
    throw new Error('render snapshot protocol version is unsupported');
  }
  if (view.getUint16(10, true) !== RENDER_HEADER_LENGTH) {
    throw new Error('render snapshot header length is invalid');
  }
  const totalByteLength = view.getUint32(16, true);
  if (totalByteLength !== bytes.byteLength) {
    throw new Error('render snapshot total length is invalid');
  }
  const entityCount = view.getUint32(40, true);
  const entityCapacity = view.getUint32(44, true);
  if (entityCount > entityCapacity) {
    throw new Error('render snapshot entity count exceeds capacity');
  }
  const regionCount = view.getUint16(52, true);
  const descriptorSize = view.getUint16(54, true);
  const regionTableOffset = view.getUint32(56, true);
  if (descriptorSize !== RENDER_REGION_DESCRIPTOR_LENGTH) {
    throw new Error('render region descriptor size is invalid');
  }
  const regionTableEnd = checkedEnd(
    regionTableOffset,
    regionCount * descriptorSize,
    totalByteLength,
    'render region table',
  );
  if (regionTableOffset < RENDER_HEADER_LENGTH || regionTableEnd > totalByteLength) {
    throw new Error('render region table is outside the header');
  }

  const regions: RenderRegionMetadata[] = [];
  const intervals: Array<{ readonly start: number; readonly end: number }> = [];
  for (let index = 0; index < regionCount; index += 1) {
    const offset = regionTableOffset + index * descriptorSize;
    const kind = view.getUint16(offset, true);
    const scalarType = view.getUint8(offset + 2);
    const componentCount = view.getUint8(offset + 3);
    if (componentCount === 0) {
      throw new Error(`render region ${index} has no components`);
    }
    const byteLength = view.getUint32(offset + 16, true);
    const capacity = view.getUint32(offset + 20, true);
    const regionOffset = view.getUint32(offset + 8, true);
    const elementCount = view.getUint32(offset + 12, true);
    const width = scalarWidth(scalarType);
    const expectedLength = elementCount * componentCount * width;
    if (!Number.isSafeInteger(expectedLength) || byteLength !== expectedLength) {
      throw new Error(`render region ${index} byte length is invalid`);
    }
    if (capacity < byteLength) {
      throw new Error(`render region ${index} capacity is too small`);
    }
    const regionEnd = checkedEnd(
      regionOffset,
      byteLength,
      totalByteLength,
      `render region ${index}`,
    );
    const capacityEnd = checkedEnd(
      regionOffset,
      capacity,
      totalByteLength,
      `render region ${index} capacity`,
    );
    if (regionOffset < regionTableEnd) {
      throw new Error(`render region ${index} overlaps the descriptor table`);
    }
    for (const interval of intervals) {
      if (regionOffset < interval.end && capacityEnd > interval.start) {
        throw new Error(`render region ${index} overlaps another region`);
      }
    }
    intervals.push({ start: regionOffset, end: Math.max(regionEnd, capacityEnd) });
    regions.push({
      kind,
      scalarType,
      componentCount,
      flags: view.getUint32(offset + 4, true),
      offset: regionOffset,
      elementCount,
      byteLength,
      capacity,
    });
  }
  return {
    totalByteLength,
    worldGeneration: view.getUint32(20, true),
    snapshotGeneration: view.getBigUint64(24, true),
    simulationTick: view.getBigUint64(32, true),
    entityCount,
    entityCapacity,
    memoryGeneration: view.getUint32(48, true),
    regions,
  };
};

export const patchRenderMemoryGeneration = (buffer: ArrayBuffer, generation: number): void => {
  if (!Number.isInteger(generation) || generation < 0 || generation > 0xffffffff) {
    throw new Error('render memory generation is outside u32');
  }
  if (buffer.byteLength < RENDER_HEADER_LENGTH) {
    throw new Error('render buffer is too small for its header');
  }
  new DataView(buffer).setUint32(48, generation, true);
};

export interface EventBatchMetadata {
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly ackFloor: bigint;
  readonly recordCount: number;
}

const eventPayloadLength = (opcode: number): number => {
  switch (opcode) {
    case 1:
      return 24;
    case 2:
      return 32;
    case 3:
    case 4:
      return 52;
    case 5:
      return 32;
    default:
      throw new Error(`event opcode ${opcode} is unsupported`);
  }
};

export const decodeEventBatch = (input: ArrayBuffer | Uint8Array): EventBatchMetadata => {
  const bytes = asBytes(input);
  if (bytes.byteLength < EVENT_HEADER_LENGTH || bytes.byteLength > MAX_EVENT_BATCH_BYTES) {
    throw new Error('event batch length is invalid');
  }
  if (!equalMagic(bytes, EVENT_MAGIC)) {
    throw new Error('event batch magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(8, true) !== PROTOCOL_VERSION) {
    throw new Error('event batch protocol version is unsupported');
  }
  if (view.getUint16(10, true) !== 0) {
    throw new Error('event batch flags are unsupported');
  }
  if (view.getUint32(12, true) !== bytes.byteLength) {
    throw new Error('event batch total length is invalid');
  }
  const firstSequence = view.getBigUint64(16, true);
  const lastSequence = view.getBigUint64(24, true);
  const recordCount = view.getUint32(32, true);
  const ackFloor = view.getBigUint64(40, true);
  if (recordCount > MAX_EVENT_RECORD_COUNT) {
    throw new Error('event batch record count exceeds the limit');
  }
  if (recordCount === 0) {
    if (firstSequence !== 0n || lastSequence !== 0n || bytes.byteLength !== EVENT_HEADER_LENGTH) {
      throw new Error('empty event batch metadata is invalid');
    }
    return { firstSequence, lastSequence, ackFloor, recordCount };
  }
  if (firstSequence === 0n || lastSequence < firstSequence) {
    throw new Error('event batch sequence range is invalid');
  }
  if (lastSequence - firstSequence + 1n !== BigInt(recordCount)) {
    throw new Error('event batch sequence range is not contiguous');
  }
  let offset = EVENT_HEADER_LENGTH;
  for (let index = 0; index < recordCount; index += 1) {
    checkedEnd(offset, EVENT_RECORD_HEADER_LENGTH, bytes.byteLength, 'event record header');
    const opcode = view.getUint16(offset, true);
    if (view.getUint16(offset + 2, true) !== 0) {
      throw new Error('event record flags are unsupported');
    }
    const payloadLength = view.getUint32(offset + 4, true);
    if (payloadLength !== eventPayloadLength(opcode)) {
      throw new Error(`event record ${index} payload length is invalid`);
    }
    const payloadStart = offset + EVENT_RECORD_HEADER_LENGTH;
    const payloadEnd = checkedEnd(payloadStart, payloadLength, bytes.byteLength, 'event record');
    const sequence = view.getBigUint64(payloadStart, true);
    if (sequence !== firstSequence + BigInt(index)) {
      throw new Error(`event record ${index} sequence is not contiguous`);
    }
    offset = payloadEnd;
  }
  if (offset !== bytes.byteLength) {
    throw new Error('event batch has trailing bytes');
  }
  return { firstSequence, lastSequence, ackFloor, recordCount };
};
