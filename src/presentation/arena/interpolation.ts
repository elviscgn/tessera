// Arena presentation model: pure, deterministic, DOM-free interpolation of
// authoritative 20 Hz snapshots onto a rendering time base (M21).
//
// The engine advances in fixed ticks. The presentation layer receives
// complete snapshots at tick boundaries and renders every intermediate
// fractional tick by interpolating consecutive snapshots. Positions travel
// linearly, so lerp in micrometres is exact for both resting and in-flight
// bodies.

export interface ArenaBodySnapshot {
  readonly id: number;
  readonly side: number;
  readonly ball: boolean;
  readonly radiusMicros: number;
  readonly xMicros: number;
  readonly zMicros: number;
  readonly vxMicrosPerTick: number;
  readonly vzMicrosPerTick: number;
}

export interface ArenaSnapshot {
  readonly tick: bigint;
  readonly phase: 'Setup' | 'Aiming' | 'Releasing' | 'Resolved';
  readonly possession: number;
  readonly score: readonly [number, number];
  readonly matchOver: boolean;
  readonly stateHashHex: string;
  readonly bodies: readonly ArenaBodySnapshot[];
}

export interface InterpolatedPose {
  readonly xMicros: number;
  readonly zMicros: number;
  /** 0 = at the earlier snapshot, 1 = at the later snapshot. */
  readonly alpha: number;
}

export interface InterpolatorState {
  readonly snapshotCount: number;
  readonly tickSpan: bigint;
  readonly firstTick: bigint;
  readonly lastTick: bigint;
}

/** Deterministic integer lerp: floor of the exact linear result. */
export function lerpMicros(from: number, to: number, alpha: number): number {
  if (alpha <= 0) return Math.floor(from);
  if (alpha >= 1) return Math.floor(to);
  const delta = to - from;
  return Math.floor(from + delta * alpha);
}

/** Interpolates every persisted body across two consecutive snapshots. */
function interpolateSnapshotPair(
  previous: ArenaSnapshot,
  next: ArenaSnapshot,
  alpha: number,
): readonly InterpolatedPose[] {
  const previousById = new Map(previous.bodies.map((body) => [body.id, body]));
  const poses: InterpolatedPose[] = [];
  for (const body of next.bodies) {
    const earlier = previousById.get(body.id);
    const pose: InterpolatedPose = {
      xMicros: earlier
        ? lerpMicros(earlier.xMicros, body.xMicros, alpha)
        : body.xMicros,
      zMicros: earlier
        ? lerpMicros(earlier.zMicros, body.zMicros, alpha)
        : body.zMicros,
      alpha: earlier ? alpha : 1,
    };
    poses.push(pose);
  }
  // Bodies removed between snapshots drop out; bodies spawned appear at rest.
  return poses;
}

export class ArenaInterpolator {
  private snapshots: readonly ArenaSnapshot[];
  private tickSpan = 0n;

  public constructor(snapshots: readonly ArenaSnapshot[] = []) {
    this.snapshots = snapshots;
  }

  public state(): InterpolatorState {
    return {
      snapshotCount: this.snapshots.length,
      tickSpan: this.tickSpan,
      firstTick: this.snapshots[0]?.tick ?? 0n,
      lastTick: this.snapshots.at(-1)?.tick ?? 0n,
    };
  }

  /** Feed a newly received authoritative snapshot. */
  public push(snapshot: ArenaSnapshot): void {
    const last = this.snapshots.at(-1);
    if (!last) {
      this.snapshots = [snapshot];
      return;
    }
    if (snapshot.tick <= last.tick) {
      return;
    }
    this.tickSpan += snapshot.tick - last.tick;
    this.snapshots = [...this.snapshots, snapshot];
  }

  /** Poses for the rendering time window ending at `tick`. */
  public sample(tick: bigint, alpha: number): readonly InterpolatedPose[] {
    const index = this.indexAt(tick);
    if (index < 0) {
      return interpolateSnapshotPair(
        this.snapshots.at(-1) ?? this.snapshots[0],
        this.snapshots.at(-1) ?? this.snapshots[0],
        1,
      );
    }
    if (index >= this.snapshots.length - 1) {
      return interpolateSnapshotPair(
        this.snapshots.at(-2) ?? this.snapshots[index],
        this.snapshots.at(-1) ?? this.snapshots[index],
        1,
      );
    }
    return interpolateSnapshotPair(this.snapshots[index], this.snapshots[index + 1], alpha);
  }

  private indexAt(tick: bigint): number {
    for (let index = this.snapshots.length - 1; index >= 0; index -= 1) {
      if (this.snapshots[index].tick <= tick) {
        return index;
      }
    }
    return -1;
  }
}