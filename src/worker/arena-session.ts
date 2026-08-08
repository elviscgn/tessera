// Authoritative arena session (M22): the client-facing boundary over the
// engine core. The session owns command sequencing, stepping, and the
// event->presentation mapping; the core stays a dumb deterministic machine.

import { encodeArenaBatch, type ArenaCommand } from './arena-encoding';
import {
  presentArenaEvents,
  type ArenaEventRecord,
  type ArenaPresentationEvent,
} from '../presentation/arena/events';
import type { ArenaSnapshot } from '../presentation/arena/interpolation';

/** The deterministic core the session drives (implemented by ArenaWasm). */
export interface ArenaSessionCore {
  submitCommandBatch(bytes: Uint8Array): void;
  advanceOneTick(): void;
  advanceTicks(count: bigint): void;
  stateHashHex(): string;
  tick(): bigint;
  phase(): number;
  possession(): number;
  score(): Uint32Array;
  isComplete(): boolean;
  stateSnapshot(): string;
  drainEvents(): string;
  dispose(): void;
}

export interface ArenaSessionOptions {
  readonly id: string;
  /** Maximum ticks accepted by one direct core `advanceTicks` call. */
  readonly maxTicksPerTick?: bigint;
  /** Bound for a single `resolveCurrentLeg` run. */
  readonly maxLegTicks?: bigint;
}

export interface ArenaSessionRecord {
  readonly sessionId: string;
  readonly appliedCommands: number;
  readonly currentTick: bigint;
}

/** Maximum ticks a leg resolution run can consume (mirrors the engine bound). */
const MAX_LEG_TICKS = 3_000n;

function parseSnapshot(json: string): ArenaSnapshot {
  const value = JSON.parse(json) as ArenaSnapshot & { tick: number | bigint };
  if (!value || typeof value !== 'object') {
    throw new Error(`arena session: invalid snapshot: ${json}`);
  }
  // The adapter serializes ticks as JSON numbers; the presentation layer
  // works in bigint time base.
  return { ...value, tick: BigInt(value.tick) };
}

export class ArenaSession {
  private readonly core: ArenaSessionCore;
  private readonly options: ArenaSessionOptions;
  private appliedCommands = 0;

  public constructor(core: ArenaSessionCore, options: ArenaSessionOptions) {
    this.core = core;
    this.options = options;
  }

  public id(): string {
    return this.options.id;
  }

  /** Encodes and submits a batch of arena commands. */
  public apply(commands: readonly ArenaCommand[]): void {
    this.core.submitCommandBatch(encodeArenaBatch(commands));
    this.appliedCommands += commands.length;
  }

  /** Advances one fixed tick of the authoritative core. */
  public step(): void {
    this.core.advanceOneTick();
  }

  /** Advances `count` fixed ticks. */
  public stepTicks(count: bigint): void {
    const bound = this.options.maxTicksPerTick ?? 2_048n;
    if (count < 0n) {
      throw new Error('arena session: negative step');
    }
    while (count > bound) {
      this.core.advanceTicks(bound);
      count -= bound;
    }
    this.core.advanceTicks(count);
  }

  /** Advances until the current leg resolves (bounded). */
  public resolveCurrentLeg(): ArenaPresentationEvent[] {
    let guard = 0n;
    while (!this.core.isComplete() && this.core.phase() !== 3) {
      if (guard >= (this.options.maxLegTicks ?? MAX_LEG_TICKS)) {
        break;
      }
      this.core.advanceOneTick();
      guard += 1n;
    }
    return this.drainPresentationEvents();
  }

  /** Current authoritative snapshot as presentation data. */
  public snapshot(): ArenaSnapshot {
    return parseSnapshot(this.core.stateSnapshot());
  }

  /** Current canonical hash. */
  public hash(): string {
    return this.core.stateHashHex();
  }

  /** Drains and presents the event log. */
  public drainPresentationEvents(): ArenaPresentationEvent[] {
    const records = JSON.parse(this.core.drainEvents()) as ArenaEventRecord[];
    const score = this.core.score();
    return presentArenaEvents(records, [score[0], score[1]], this.core.isComplete());
  }

  /** Stable machine-readable identity for the current session. */
  public record(): ArenaSessionRecord {
    return {
      sessionId: this.options.id,
      appliedCommands: this.appliedCommands,
      currentTick: this.core.tick(),
    };
  }

  public dispose(): void {
    this.core.dispose();
  }
}