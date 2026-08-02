import type {
  ObjectTypeDefinition,
  PlacementTarget,
  ScenarioDefinition,
} from '../../../src/public/index';

export type LabId =
  | 'camera'
  | 'placement'
  | 'entity-stress'
  | 'simulation-stress'
  | 'boundary'
  | 'persistence'
  | 'museum'
  | 'errors'
  | 'lifecycle';

export interface LabDefinition {
  readonly id: LabId;
  readonly label: string;
  readonly eyebrow: string;
  readonly description: string;
}

export const LAB_DEFINITIONS: readonly LabDefinition[] = [
  {
    id: 'camera',
    label: 'Camera',
    eyebrow: '01 · Coordinate space',
    description: 'Probe the right-handed isometric projection and its grid contract.',
  },
  {
    id: 'placement',
    label: 'Placement',
    eyebrow: '02 · Authoritative grid',
    description: 'Query footprints, rotate previews, and submit placement commands.',
  },
  {
    id: 'entity-stress',
    label: 'Entity stress',
    eyebrow: '03 · Renderer scale',
    description: 'Populate a deterministic field and inspect grouped Babylon visuals.',
  },
  {
    id: 'simulation-stress',
    label: 'Simulation stress',
    eyebrow: '04 · Fixed ticks',
    description: 'Advance exact ticks and compare throughput with state-hash checkpoints.',
  },
  {
    id: 'boundary',
    label: 'Boundary',
    eyebrow: '05 · Worker / Wasm',
    description: 'Inspect packed calls, memory views, buffers, events, and backpressure.',
  },
  {
    id: 'persistence',
    label: 'Persistence',
    eyebrow: '06 · Save contract',
    description: 'Save, restore, corrupt, and verify failure-preserving loads.',
  },
  {
    id: 'museum',
    label: 'Visual museum',
    eyebrow: '07 · Canonical scenes',
    description: 'Load fixed scenes for visual review and annotated captures.',
  },
  {
    id: 'errors',
    label: 'Errors',
    eyebrow: '08 · Recovery paths',
    description: 'Exercise structured rejection without weakening the active world.',
  },
  {
    id: 'lifecycle',
    label: 'Lifecycle',
    eyebrow: '09 · Ownership',
    description: 'Reset repeatedly and watch generations, mappings, and shutdown state.',
  },
];

export const SCENARIO: ScenarioDefinition = { id: 'scenario-lab' };

export const OBJECT_TYPES: readonly ObjectTypeDefinition[] = [
  { id: 'foundation' },
  {
    id: 'warehouse',
    footprint: [
      { dx: 0, dz: 0 },
      { dx: 1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 1, dz: 1 },
    ],
  },
  {
    id: 'watchtower',
    footprint: [
      { dx: 0, dz: 0 },
      { dx: 0, dz: 1 },
    ],
  },
];

export const SEED = new Uint8Array(32).fill(0x2a);
export const SEED_HEX = Array.from(SEED, (value) => value.toString(16).padStart(2, '0')).join('');

export const objectTypeById = (id: string): ObjectTypeDefinition => {
  const definition = OBJECT_TYPES.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`unknown Scenario Lab object type: ${id}`);
  }
  return definition;
};

const assertNonNegativeInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
};

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
};

export const gridForIndex = (
  index: number,
  columns = 10,
): { readonly x: number; readonly z: number } => {
  assertNonNegativeInteger(index, 'stress index');
  assertPositiveInteger(columns, 'stress columns');
  const row = Math.floor(index / columns);
  const column = index % columns;
  return { x: column * 3 - Math.floor(columns / 2) * 3, z: row * 3 - 6 };
};

export const targetAt = (
  objectType: string,
  cell: { readonly x: number; readonly z: number },
  rotation = 0,
): PlacementTarget => ({
  objectType,
  x: cell.x,
  z: cell.z,
  elevationMm: 0,
  rotation,
});

const BYTE_FORMATS = [
  { threshold: 1024 * 1024, divisor: 1024 * 1024, suffix: 'MiB', digits: 2 },
  { threshold: 1024, divisor: 1024, suffix: 'KiB', digits: 1 },
] as const;

export const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return '—';
  }
  const format = BYTE_FORMATS.find((candidate) => bytes >= candidate.threshold);
  if (format === undefined) {
    return `${Math.round(bytes)} B`;
  }
  return `${(bytes / format.divisor).toFixed(format.digits)} ${format.suffix}`;
};

export const formatHash = (hash: string | undefined): string =>
  hash === undefined ? '—' : `${hash.slice(0, 12)}…${hash.slice(-8)}`;

export const formatCount = (value: number | bigint | undefined): string =>
  value === undefined ? '—' : value.toLocaleString('en-US');

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
