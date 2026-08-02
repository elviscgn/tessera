import { describe, expect, it } from 'vitest';
import {
  MemoryPersistenceAdapter,
  createIndexedDbPersistenceAdapter,
  exportSaveFile,
  importSaveFile,
  type IndexedDbPersistenceOptions,
  type LoadResult,
  type PersistenceAdapter,
} from '../../src/public/index';

describe('persistence adapters', () => {
  it('keeps memory saves opaque and returns defensive copies', async () => {
    const adapter: PersistenceAdapter = new MemoryPersistenceAdapter();
    expect(await adapter.read()).toBeUndefined();
    const source = new Uint8Array([1, 2, 3]);
    await adapter.write(source);
    source[0] = 9;
    const first = await adapter.read();
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    if (first === undefined) {
      throw new Error('expected a saved value');
    }
    first[1] = 8;
    await expect(adapter.read()).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('imports file bytes without interpreting the save document', async () => {
    await expect(importSaveFile(new Blob(['{"opaque":true}']))).resolves.toEqual(
      new Uint8Array([123, 34, 111, 112, 97, 113, 117, 101, 34, 58, 116, 114, 117, 101, 125]),
    );
  });

  it('exposes browser adapters without requiring IndexedDB in native tests', async () => {
    const options: IndexedDbPersistenceOptions = { databaseName: 'tessera-test' };
    const indexedDb = createIndexedDbPersistenceAdapter(options);
    await expect(indexedDb.read()).rejects.toThrow('indexeddb_unavailable');
    expect(exportSaveFile).toBeTypeOf('function');
    const result: LoadResult = { tick: 0n, stateHashHex: '00'.repeat(32), worldGeneration: 1 };
    expect(result.worldGeneration).toBe(1);
  });
});
