import { describe, expect, it } from 'vitest';
import { ArenaSession, type ArenaSessionCore } from '../../src/worker/arena-session';
import type { ArenaCommand } from '../../src/worker/arena-command';

/** Scripted core: records calls and returns canned authoritative data. */
class FakeCore implements ArenaSessionCore {
  public submitted: string[] = [];
  public advancedTicks = 0n;
  public phaseValue = 0;
  public possessionValue = 0;
  public scoreValue = new Uint32Array([0, 0]);
  public complete = false;
  public hash = 'canned-hash';
  public tickValue = 0n;
  public snapshotJson =
    '{"tick":1,"phase":"Resolved","possession":0,"score":[0,0],"matchOver":false,"stateHashHex":"c","bodies":[]}';
  public eventsJson = '[{"kind":"released"}]';
  public disposed = false;

  submit_commands_json(json: string): void {
    this.submitted.push(json);
  }
  advance_one_tick(): void {
    this.advancedTicks += 1n;
  }
  advance_ticks(count: bigint): void {
    this.advancedTicks += count;
  }
  state_hash_hex(): string {
    return this.hash;
  }
  tick(): bigint {
    return this.tickValue;
  }
  phase(): number {
    return this.phaseValue;
  }
  possession(): number {
    return 0;
  }
  score(): Uint32Array {
    return this.scoreValue;
  }
  is_complete(): boolean {
    return this.complete;
  }
  state_snapshot(): string {
    return this.snapshotJson;
  }
  drain_events(): string {
    return this.eventsJson;
  }
  dispose(): void {
    this.disposed = true;
  }
}

describe('arena session', () => {
  it('applies batches through the semantic command stream', () => {
    const core = new FakeCore();
    const session = new ArenaSession(core, { id: 's1' });
    const placement = [
      {
        kind: 'place',
        payload: { body: 1, radiusMicros: 37_000, xMicros: 0, zMicros: 0, side: 0, ball: true },
      },
    ] satisfies readonly ArenaCommand[];
    session.apply(placement);
    session.apply([{ kind: 'release', payload: {} }]);
    expect(core.submitted).toHaveLength(2);
    expect(core.submitted[0]).toBe(JSON.stringify(placement));
    expect(JSON.parse(core.submitted[1] ?? '')).toEqual([{ kind: 'release', payload: {} }]);
    expect(session.record().appliedCommands).toBe(2);
  });

  it('steps in bounded chunks and resolves a leg', () => {
    const core = new FakeCore();
    core.phaseValue = 2; // Releasing
    const session = new ArenaSession(core, { id: 's2', maxTicksPerTick: 2n });
    session.stepTicks(5n);
    expect(core.advancedTicks).toBe(5n);
    const events = session.resolveCurrentLeg();
    expect(core.advancedTicks).toBeGreaterThan(5);
    expect(session.drainPresentationEvents()).toContainEqual({ kind: 'release' });
    expect(events).toContainEqual({ kind: 'release' });
  });

  it('surfaces a snapshot and disposes the core', () => {
    const core = new FakeCore();
    const session = new ArenaSession(core, { id: 's3' });
    const snapshot = session.snapshot();
    expect(snapshot.tick).toBe(1n);
    expect(snapshot.phase).toBe('Resolved');
    session.dispose();
    expect(core.disposed).toBe(true);
  });
});
