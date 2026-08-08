import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, ArenaWasm } from '../../src/worker/wasm/tessera_wasm.js';
import { encodeArenaBatch } from '../../src/worker/arena-encoding';

// Pinned from `cargo run -p tessera-arena --example arena_probe`:
// two placements, one tick, then StartTurn + Aim(600) + Release and 3 ticks.
const PROBE_HASH =
  '9d9fbb9fd3a81349eafd57bc8ff966bf82cc900efa180e5b50587a8b6ead02c3';

const placement = () =>
  encodeArenaBatch([
    {
      kind: 'place',
      payload: { body: 1, radiusMicros: 37_000, xMicros: 0, zMicros: 0, side: 0, ball: true },
    },
    {
      kind: 'place',
      payload: {
        body: 2,
        radiusMicros: 45_000,
        xMicros: -100_000,
        zMicros: 200_000,
        side: 0,
        ball: false,
      },
    },
  ]);

const shot = () =>
  encodeArenaBatch([
    { kind: 'startTurn', payload: { side: 0 } },
    { kind: 'aim', payload: { directionXMicros: 1, directionZMicros: 0, powerMilli: 600 } },
    { kind: 'release', payload: {} },
  ]);

describe('arena Wasm adapter', () => {
  it('matches the native probe checkpoint through the binary boundary', () => {
    initSync({
      module: readFileSync(new URL('../../src/worker/wasm/tessera_wasm_bg.wasm', import.meta.url)),
    });
    const arena = new ArenaWasm(5);
    try {
      arena.submit_command_batch(placement());
      arena.advance_one_tick();
      arena.submit_command_batch(shot());
      arena.advance_ticks(3n);
      expect(arena.state_hash_hex()).toBe(PROBE_HASH);

      expect(arena.tick()).toBe(4n);
      expect(arena.phase()).toBe(2); // Releasing
      expect(arena.possession()).toBe(0);
      expect(arena.score()).toEqual(new Uint32Array([0, 0]));

      const snapshot = JSON.parse(arena.state_snapshot());
      expect(snapshot.bodies).toHaveLength(2);
      expect(snapshot.bodies[0]).toMatchObject({ id: 1, ball: true });
    } finally {
      arena.dispose();
    }
  });

  it('exposes deterministic rejection and power semantics over the boundary', () => {
    initSync({
      module: readFileSync(new URL('../../src/worker/wasm/tessera_wasm_bg.wasm', import.meta.url)),
    });
    const arena = new ArenaWasm(5);
    try {
      arena.submit_command_batch(placement());
      arena.advance_one_tick();
      // Illegal: a second ball.
      arena.submit_command_batch(
        encodeArenaBatch([
          {
            kind: 'place',
            payload: { body: 9, radiusMicros: 37_000, xMicros: 0, zMicros: 0, side: 1, ball: true },
          },
        ]),
      );
      arena.advance_one_tick();
      const events = JSON.parse(arena.drain_events());
      expect(events.at(-1)).toMatchObject({ kind: 'rejected', reason: 'UnknownBody' });

      // Legal: an out-of-bounds guard query agrees with the engine.
      expect(arena.validate_placement(45_000n, 0n, 0n)).toBe(true);
      expect(arena.validate_placement(45_000n, 5_000_000n, 0n)).toBe(false);
    } finally {
      arena.dispose();
    }
  });
});