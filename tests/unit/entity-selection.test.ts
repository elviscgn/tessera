import { describe, expect, it } from 'vitest';
import {
  boundsFromPoints,
  formatEntityId,
  parseEntityId,
} from '../../src/renderer/entity-selection';
import { SelectionActionLayer } from '../../src/input/selection-action-layer';

describe('stable entity selection helpers', () => {
  it('round-trips the canonical slot and generation ID', () => {
    const entityId = formatEntityId({ slot: 12, generation: 4 });
    expect(entityId).toBe('12:4');
    expect(parseEntityId(entityId)).toEqual({ slot: 12, generation: 4 });
    expect(parseEntityId('12:0')).toBeUndefined();
    expect(parseEntityId('12/4')).toBeUndefined();
  });

  it('rejects stale or out-of-range handles before they become public IDs', () => {
    expect(() => formatEntityId({ slot: -1, generation: 1 })).toThrow('canonical u32');
    expect(() => formatEntityId({ slot: 1, generation: 0 })).toThrow('canonical u32');
    expect(parseEntityId('4294967296:1')).toBeUndefined();
  });

  it('computes a stable CSS-pixel rectangle from projected corners', () => {
    expect(
      boundsFromPoints([
        { x: 20, y: 40 },
        { x: 4, y: 12 },
        { x: 16, y: 28 },
      ]),
    ).toEqual({ left: 4, top: 12, right: 20, bottom: 40, width: 16, height: 28 });
    expect(boundsFromPoints([])).toBeUndefined();
    expect(boundsFromPoints([{ x: Number.NaN, y: 1 }])).toBeUndefined();
  });

  it('turns only primary canvas clicks into canvas-relative points', () => {
    let clickListener: ((event: Event) => void) | undefined;
    let removedListener: ((event: Event) => void) | undefined;
    const canvas = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        clickListener = listener as (event: Event) => void;
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        removedListener = listener as (event: Event) => void;
      },
      getBoundingClientRect: () => ({ left: 12, top: 8, width: 640, height: 360 }),
    } as unknown as HTMLCanvasElement;
    const points: Array<{ x: number; y: number }> = [];
    const layer = new SelectionActionLayer({
      canvas,
      onPrimaryClick: (point) => points.push(point),
    });

    layer.attach();
    clickListener?.({ button: 2, clientX: 100, clientY: 100 } as MouseEvent);
    clickListener?.({ button: 0, clientX: 100, clientY: 100 } as MouseEvent);
    layer.attach();
    layer.dispose();

    expect(points).toEqual([{ x: 88, y: 92 }]);
    expect(removedListener).toBe(clickListener);
  });
});
