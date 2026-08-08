import { describe, expect, it } from 'vitest';
import {
  ArenaCamera,
  formatPhase,
  formatScore,
  presentArenaEvents,
} from '../../src/presentation/arena';
import {
  ArenaInterpolator,
  lerpMicros,
  type ArenaBodySnapshot,
  type ArenaSnapshot,
} from '../../src/presentation/arena/interpolation';

function body(id: number, xMicros: number, zMicros: number, ball = false): ArenaBodySnapshot {
  return {
    id,
    side: id % 2,
    ball,
    radiusMicros: ball ? 37_000 : 45_000,
    xMicros,
    zMicros,
    vxMicrosPerTick: 0,
    vzMicrosPerTick: 0,
  };
}

function snapshot(tick: bigint, bodies: ArenaBodySnapshot[]): ArenaSnapshot {
  return {
    tick,
    phase: tick === 0n ? 'Setup' : 'Releasing',
    possession: 0,
    score: [0, 0],
    matchOver: false,
    stateHashHex: `hash-${tick}`,
    bodies,
  };
}

describe('arena lerp', () => {
  it('stays deterministic at fractional alphas', () => {
    expect(lerpMicros(0, 100, 0.5)).toBe(50);
    expect(lerpMicros(0, 100, 0.25)).toBe(25);
    expect(lerpMicros(0, 3, 0.5)).toBe(1); // floor semantics
    expect(lerpMicros(0, 100, 0)).toBe(0);
    expect(lerpMicros(0, 100, 1)).toBe(100);
  });
});

describe('arena interpolation', () => {
  it('interpolates only persisted bodies in order', () => {
    const previous = snapshot(10n, [body(1, 0, 0, true)]);
    const next = snapshot(11n, [body(1, 80, 0, true), body(2, 10, 10)]);
    const interp = new ArenaInterpolator([previous]);
    interp.push(next);
    const poses = interp.sample(10n, 0.5);
    expect(poses).toHaveLength(2);
    expect(poses[0]).toEqual({ xMicros: 40, zMicros: 0, alpha: 0.5 });
    expect(poses[1]).toEqual({ xMicros: 10, zMicros: 10, alpha: 1 });
  });

  it('samples the window between adjacent snapshots', () => {
    const interp = new ArenaInterpolator([
      snapshot(1n, [body(1, 0, 0, true)]),
      snapshot(2n, [body(1, 100, 0, true)]),
    ]);
    const atHalf = interp.sample(1n, 0.5);
    expect(atHalf[0]).toMatchObject({ xMicros: 50 });
    const atStart = interp.sample(1n, 0);
    expect(atStart[0]).toMatchObject({ xMicros: 0 });
    const after = interp.sample(2n, 1);
    expect(after[0]).toMatchObject({ xMicros: 100 });
  });

  it('ignores stale snapshots', () => {
    const interp = new ArenaInterpolator([snapshot(2n, [body(1, 0, 0, true)])]);
    interp.push(snapshot(1n, [body(1, 500, 0, true)]));
    expect(interp.state().snapshotCount).toBe(1);
    interp.push(snapshot(3n, [body(1, 50, 0, true)]));
    expect(interp.state().snapshotCount).toBe(2);
    expect(interp.state().tickSpan).toBe(1n);
    expect(interp.sample(3n, 1)[0]).toMatchObject({ xMicros: 50 });
  });
});

describe('arena camera', () => {
  it('pins the table centre and scales by view', () => {
    const camera = ArenaCamera.fitView(2_300_000, { widthPixels: 1000, heightPixels: 600 });
    expect(camera.project(0, 0)).toEqual({ x: 500, y: 300 });
    const corner = camera.project(-1_150_000, -600_000);
    expect(corner.x).toBeLessThan(500);
    expect(corner.y).toBeLessThan(300);
  });

  it('applies zoom and pan without mutating the source camera', () => {
    const base = ArenaCamera.fitView(2_300_000, { widthPixels: 1000, heightPixels: 600 });
    const zoomed = base.withZoom(2);
    expect(base.pixelsPerMillimetre * 2).toBeCloseTo(zoomed.pixelsPerMillimetre, 10);
    const panned = base.withPan(10, -20);
    expect(panned.project(0, 0)).toEqual({ x: 510, y: 280 });
    expect(base.project(0, 0)).toEqual({ x: 500, y: 300 });
  });

  it('round-trips project/unproject', () => {
    const camera = ArenaCamera.fitView(2_300_000, { widthPixels: 1000, heightPixels: 600 });
    const projected = camera.project(1_000_000, -500_000);
    const [x, z] = camera.unproject(projected.x, projected.y);
    expect(x).toBeCloseTo(1_000_000, 0);
    expect(z).toBeCloseTo(-500_000, 0);
  });
});

describe('arena events', () => {
  it('maps adapter records to presentation events', () => {
    const mapped = presentArenaEvents(
      [
        { kind: 'turn_started', side: 1 },
        { kind: 'aimed', power_milli: 750 },
        { kind: 'released' },
        { kind: 'goal', side: 1 },
        { kind: 'power_on', side: 0, handle: 1 },
        { kind: 'rejected', reason: 'InvalidPhase' },
      ],
      [1, 2],
      true,
    );
    expect(mapped).toEqual([
      { kind: 'turn', side: 1 },
      { kind: 'aim', powerMilli: 750 },
      { kind: 'release' },
      { kind: 'goal', side: 1 },
      { kind: 'powerUp', side: 0, handle: 1 },
      { kind: 'rejected', reason: 'InvalidPhase' },
      { kind: 'matchOver', winner: 1 },
    ]);
  });

  it('formats score and phase labels', () => {
    expect(formatScore([2, 3])).toBe('2–3');
    expect(formatPhase('Setup')).toBe('Formation');
    expect(formatPhase('Releasing')).toBe('In play');
    expect(formatPhase('Resolved')).toBe('Leg over');
  });
});
