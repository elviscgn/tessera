import { describe, expect, it } from 'vitest';
import { BabylonRenderer } from '../../src/renderer/babylon-renderer';

describe('Babylon renderer lifecycle contract', () => {
  it('keeps the runtime-owned lifecycle and camera surface intact', () => {
    const prototype = BabylonRenderer.prototype;
    expect(typeof prototype.start).toBe('function');
    expect(typeof prototype.consumeSnapshot).toBe('function');
    expect(typeof prototype.diagnostics).toBe('function');
    expect(typeof prototype.dispose).toBe('function');
  });
});
