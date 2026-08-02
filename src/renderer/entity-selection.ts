/** Stable selection identifiers and screen-space geometry helpers. */

export type EntityId = string;

export interface EntityHandle {
  readonly slot: number;
  readonly generation: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Converts a validated generational handle to the public opaque ID format. */
export const formatEntityId = (handle: EntityHandle): EntityId => {
  if (
    !Number.isSafeInteger(handle.slot) ||
    handle.slot < 0 ||
    handle.slot > 0xffffffff ||
    !Number.isSafeInteger(handle.generation) ||
    handle.generation <= 0 ||
    handle.generation > 0xffffffff
  ) {
    throw new Error('entity handle is outside the canonical u32 range');
  }
  return `${handle.slot}:${handle.generation}`;
};

/** Parses the canonical ID only at an explicit public boundary. */
export const parseEntityId = (value: string): EntityHandle | undefined => {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const slot = Number(match[1]);
  const generation = Number(match[2]);
  if (
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    slot > 0xffffffff ||
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    generation > 0xffffffff
  ) {
    return undefined;
  }
  return { slot, generation };
};

/** Returns a finite bounding rectangle for projected points. */
export const boundsFromPoints = (points: readonly ScreenPoint[]): ScreenBounds | undefined => {
  if (
    points.length === 0 ||
    points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return undefined;
  }
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};
