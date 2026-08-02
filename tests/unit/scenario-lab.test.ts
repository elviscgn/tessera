import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatHash,
  gridForIndex,
  LAB_DEFINITIONS,
  OBJECT_TYPES,
  targetAt,
} from '../../apps/scenario-lab/src/lab-model';

describe('Scenario Lab model', () => {
  it('exposes every deterministic laboratory in a stable order', () => {
    expect(LAB_DEFINITIONS.map((definition) => definition.id)).toEqual([
      'camera',
      'placement',
      'entity-stress',
      'simulation-stress',
      'boundary',
      'persistence',
      'museum',
      'errors',
      'lifecycle',
    ]);
  });

  it('uses stable object definitions and grid positions for stress scenes', () => {
    expect(OBJECT_TYPES.map((definition) => definition.id)).toEqual([
      'foundation',
      'warehouse',
      'watchtower',
    ]);
    expect(gridForIndex(0)).toEqual({ x: -15, z: -6 });
    expect(gridForIndex(11)).toEqual({ x: -12, z: -3 });
    expect(targetAt('warehouse', gridForIndex(4), 3)).toMatchObject({
      objectType: 'warehouse',
      x: -3,
      z: -6,
      rotation: 3,
      elevationMm: 0,
    });
  });

  it('formats boundary and hash readouts without changing the source values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MiB');
    expect(formatHash(undefined)).toBe('—');
    expect(formatHash('ab'.repeat(32))).toBe('abababababab…abababab');
  });
});
