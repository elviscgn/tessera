import type { RenderEntityRecord, RenderSnapshotMetadata } from '../worker/data-protocol';

/** The presentation mapping retained for one slot in the renderer. */
export interface VisualMapping {
  readonly slot: number;
  readonly generation: number;
  readonly visualType: number;
}

/** State needed to reject stale snapshots before touching Babylon objects. */
export interface VisualReconciliationState {
  readonly worldGeneration: number | undefined;
  readonly snapshotGeneration: bigint | undefined;
  readonly mappings: readonly VisualMapping[];
}

export type VisualReconciliationOperation =
  | { readonly type: 'create'; readonly entity: RenderEntityRecord }
  | {
      readonly type: 'update';
      readonly previous: VisualMapping;
      readonly entity: RenderEntityRecord;
    }
  | {
      readonly type: 'replace';
      readonly previous: VisualMapping;
      readonly entity: RenderEntityRecord;
      readonly reason: 'generation' | 'visual-type';
    }
  | {
      readonly type: 'remove';
      readonly previous: VisualMapping;
      readonly reason: 'missing';
    };

export interface VisualReconciliationResult {
  readonly applied: boolean;
  readonly reset: boolean;
  readonly staleSnapshot: boolean;
  readonly worldGeneration: number;
  readonly snapshotGeneration: bigint;
  readonly mappings: readonly VisualMapping[];
  readonly operations: readonly VisualReconciliationOperation[];
  readonly staleMappingCount: number;
}

const mappingFor = (entity: RenderEntityRecord): VisualMapping => ({
  slot: entity.slot,
  generation: entity.generation,
  visualType: entity.visualType,
});

const isStaleSnapshot = (
  state: VisualReconciliationState,
  snapshot: Pick<RenderSnapshotMetadata, 'worldGeneration' | 'snapshotGeneration'>,
): boolean =>
  (state.worldGeneration !== undefined && snapshot.worldGeneration < state.worldGeneration) ||
  (state.worldGeneration === snapshot.worldGeneration &&
    state.snapshotGeneration !== undefined &&
    snapshot.snapshotGeneration < state.snapshotGeneration);

const staleResult = (
  state: VisualReconciliationState,
  snapshot: Pick<RenderSnapshotMetadata, 'worldGeneration' | 'snapshotGeneration'>,
): VisualReconciliationResult => ({
  applied: false,
  reset: false,
  staleSnapshot: true,
  worldGeneration: state.worldGeneration ?? snapshot.worldGeneration,
  snapshotGeneration: state.snapshotGeneration ?? snapshot.snapshotGeneration,
  mappings: state.mappings,
  operations: [],
  staleMappingCount: 0,
});

const operationForEntity = (
  prior: VisualMapping | undefined,
  entity: RenderEntityRecord,
): { readonly operation: VisualReconciliationOperation; readonly staleMapping: boolean } => {
  if (prior === undefined) {
    return { operation: { type: 'create', entity }, staleMapping: false };
  }
  if (prior.generation !== entity.generation) {
    return {
      operation: { type: 'replace', previous: prior, entity, reason: 'generation' },
      staleMapping: true,
    };
  }
  if (prior.visualType !== entity.visualType) {
    return {
      operation: { type: 'replace', previous: prior, entity, reason: 'visual-type' },
      staleMapping: false,
    };
  }
  return { operation: { type: 'update', previous: prior, entity }, staleMapping: false };
};

const missingOperations = (
  previous: readonly VisualMapping[],
  seen: ReadonlySet<number>,
): readonly VisualReconciliationOperation[] =>
  previous
    .filter((entry) => !seen.has(entry.slot))
    .map((previous) => ({ type: 'remove', previous, reason: 'missing' as const }));

/**
 * Computes a deterministic presentation diff without allocating Babylon
 * objects. The renderer applies the operations to its disposable instances.
 */
export const reconcileVisualMappings = (
  state: VisualReconciliationState,
  snapshot: Pick<RenderSnapshotMetadata, 'worldGeneration' | 'snapshotGeneration'>,
  entities: readonly RenderEntityRecord[],
): VisualReconciliationResult => {
  if (isStaleSnapshot(state, snapshot)) {
    return staleResult(state, snapshot);
  }

  const reset =
    state.worldGeneration !== undefined && snapshot.worldGeneration > state.worldGeneration;
  const previous = new Map<number, VisualMapping>(
    reset ? [] : state.mappings.map((entry) => [entry.slot, entry]),
  );
  const seen = new Set(entities.map(({ slot }) => slot));
  const entityOperations = entities.map((entity) =>
    operationForEntity(previous.get(entity.slot), entity),
  );
  const operations = entityOperations.map(({ operation }) => operation);
  const staleMappingCount = entityOperations.filter(({ staleMapping }) => staleMapping).length;
  if (!reset) {
    operations.push(...missingOperations(state.mappings, seen));
  }

  return {
    applied: true,
    reset,
    staleSnapshot: false,
    worldGeneration: snapshot.worldGeneration,
    snapshotGeneration: snapshot.snapshotGeneration,
    mappings: entities.map(mappingFor),
    operations,
    staleMappingCount,
  };
};
