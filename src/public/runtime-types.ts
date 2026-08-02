/** Declarative object metadata accepted during runtime initialization. */
export interface ObjectTypeDefinition {
  /** Stable consumer-owned identifier preserved by saves and replays. */
  readonly id: string;
  /** Optional anchor-relative footprint; omitted means one cell. */
  readonly footprint?: readonly { readonly dx: number; readonly dz: number }[];
}

/** Minimal scenario identity used by the runtime initialization contract. */
export interface ScenarioDefinition {
  /** Stable consumer-owned scenario identifier. */
  readonly id: string;
}

/** An integer placement target expressed in public object-type IDs. */
export interface PlacementTarget {
  readonly objectType: string;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
}

/** An integer transform used when moving an existing entity. */
export type EntityTransformTarget = Omit<PlacementTarget, 'objectType'>;

/** Rust's non-mutating placement query result. */
export interface PlacementValidation {
  readonly objectType: string;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly rotation: number;
  readonly valid: boolean;
  readonly rejectionCode?: number;
  readonly occupiedCellCount: number;
}

/** Presentation-only placement preview state supplied to a renderer. */
export interface PlacementPreview extends PlacementValidation {
  readonly pending: boolean;
}
