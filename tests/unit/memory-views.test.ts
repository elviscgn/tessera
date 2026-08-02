import { describe, expect, it } from 'vitest';
import { MemoryViewTracker } from '../../src/worker/memory-views';

describe('Wasm memory view generation', () => {
  it('recreates the host generation after linear-memory growth', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const tracker = new MemoryViewTracker();

    const firstBuffer = tracker.sync(memory);
    expect(firstBuffer.byteLength).toBe(64 * 1024);
    expect(tracker.generation).toBe(1);
    expect(tracker.recreations).toBe(1);
    expect(tracker.sync(memory)).toBe(firstBuffer);
    expect(tracker.generation).toBe(1);

    memory.grow(1);
    const secondBuffer = tracker.sync(memory);
    expect(secondBuffer).not.toBe(firstBuffer);
    expect(secondBuffer.byteLength).toBe(128 * 1024);
    expect(tracker.generation).toBe(2);
    expect(tracker.recreations).toBe(2);
  });
});
