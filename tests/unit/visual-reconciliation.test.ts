import { describe, expect, it } from 'vitest';
import {
  reconcileVisualMappings,
  type VisualReconciliationState,
} from '../../src/renderer/visual-reconciliation';
import type { RenderEntityRecord } from '../../src/worker/data-protocol';

const entity = (
  slot: number,
  generation: number,
  visualType: number,
  x = slot,
): RenderEntityRecord => ({
  slot,
  generation,
  x,
  z: 0,
  elevationMm: 0,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
  visualType,
  renderFlags: 0,
});

const snapshot = (worldGeneration: number, snapshotGeneration: bigint) => ({
  worldGeneration,
  snapshotGeneration,
});

const state = (overrides: Partial<VisualReconciliationState> = {}): VisualReconciliationState => ({
  worldGeneration: 1,
  snapshotGeneration: 1n,
  mappings: [
    { slot: 0, generation: 1, visualType: 1 },
    { slot: 1, generation: 1, visualType: 1 },
  ],
  ...overrides,
});

describe('renderer visual reconciliation', () => {
  it('creates, updates, replaces, and removes slot mappings deterministically', () => {
    const result = reconcileVisualMappings(state(), snapshot(1, 2n), [
      entity(0, 1, 1, 4),
      entity(1, 2, 1),
      entity(2, 1, 3),
    ]);

    expect(result.applied).toBe(true);
    expect(result.reset).toBe(false);
    expect(result.staleMappingCount).toBe(1);
    expect(result.operations.map((operation) => operation.type)).toEqual([
      'update',
      'replace',
      'create',
    ]);
    expect(result.operations[1]).toMatchObject({ type: 'replace', reason: 'generation' });
  });

  it('removes entities absent from the newest snapshot and replaces visual groups', () => {
    const result = reconcileVisualMappings(state(), snapshot(1, 2n), [entity(0, 1, 2)]);

    expect(result.operations).toEqual([
      {
        type: 'replace',
        previous: { slot: 0, generation: 1, visualType: 1 },
        entity: entity(0, 1, 2),
        reason: 'visual-type',
      },
      {
        type: 'remove',
        previous: { slot: 1, generation: 1, visualType: 1 },
        reason: 'missing',
      },
    ]);
  });

  it('resets mappings for a newer world and rejects stale generations', () => {
    const reset = reconcileVisualMappings(state(), snapshot(2, 1n), [entity(4, 1, 2)]);
    expect(reset.reset).toBe(true);
    expect(reset.operations.map((operation) => operation.type)).toEqual(['create']);
    expect(reset.mappings).toEqual([{ slot: 4, generation: 1, visualType: 2 }]);

    const staleWorld = reconcileVisualMappings(state(), snapshot(0, 9n), []);
    expect(staleWorld.applied).toBe(false);
    expect(staleWorld.staleSnapshot).toBe(true);
    expect(staleWorld.mappings).toEqual(state().mappings);

    const staleSnapshot = reconcileVisualMappings(state(), snapshot(1, 0n), []);
    expect(staleSnapshot.applied).toBe(false);
    expect(staleSnapshot.staleSnapshot).toBe(true);
  });
});
