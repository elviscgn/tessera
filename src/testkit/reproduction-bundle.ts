/**
 * Versioned, dependency-free reproduction bundle metadata.
 *
 * The manifest is intentionally plain data. A browser can download it beside
 * screenshots, traces, and logs, while a native tool can validate the same
 * directory without importing browser code or an archive library.
 */

import { exportSaveFile } from '../persistence/adapters';

export const REPRODUCTION_BUNDLE_FORMAT = 'tessera.reproduction';
export const REPRODUCTION_BUNDLE_VERSION = 1;

export type ReproductionArtifactKind =
  'snapshot' | 'screenshot' | 'visual-diff' | 'trace' | 'log' | 'worker-log';

export interface ReproductionCommandRecord {
  readonly kind: 'place' | 'move' | 'remove' | 'raw';
  /** Monotonic sequence assigned by the capture surface. */
  readonly sequence: string;
  readonly submittedTick: string;
  /** Tick at which Rust schedules this command for evaluation. */
  readonly assignedTick: string;
  readonly exactTicks: number;
  readonly payload: Readonly<Record<string, number | string>>;
}

export interface ReproductionSnapshotRecord {
  readonly tick: string;
  readonly snapshotGeneration: string;
  readonly worldGeneration: number;
  readonly entityCount: number;
  readonly occupiedCellCount: number;
}

export interface ReproductionHashRecord {
  readonly tick: string;
  readonly stateHashHex: string;
}

export interface ReproductionErrorRecord {
  readonly phase: string;
  readonly code: string;
  readonly message: string;
  readonly tick?: string;
}

export interface ReproductionLogRecord {
  readonly stream: 'browser' | 'worker' | 'runtime';
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly tick?: string;
}

export interface ReproductionArtifactReference {
  readonly path: string;
  readonly kind: ReproductionArtifactKind;
  readonly mediaType: string;
  readonly byteLength?: number;
  readonly sha256?: string;
}

export interface ReproductionEnvironment {
  readonly userAgent?: string;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly devicePixelRatio?: number;
  readonly browser?: string;
  readonly graphicsBackend?: string;
  readonly qualitySettings?: Readonly<Record<string, string | number | boolean>>;
  readonly extra?: Readonly<Record<string, string | number | boolean>>;
}

export interface ReproductionBundleManifest {
  readonly format: string;
  readonly version: number;
  readonly scenarioId: string;
  readonly seedHex: string;
  readonly frameworkVersion: string;
  readonly protocolVersion: number;
  readonly gameId: string;
  readonly schemaVersion: number;
  readonly commands: readonly ReproductionCommandRecord[];
  readonly snapshots: readonly ReproductionSnapshotRecord[];
  readonly hashes: readonly ReproductionHashRecord[];
  readonly errors: readonly ReproductionErrorRecord[];
  readonly logs: readonly ReproductionLogRecord[];
  readonly artifacts: readonly ReproductionArtifactReference[];
  readonly metrics: Readonly<Record<string, number | string | boolean>>;
  readonly environment: ReproductionEnvironment;
}

export type ReproductionBundleInput = Omit<ReproductionBundleManifest, 'format' | 'version'>;

export interface ReproductionDirectoryEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonEmpty = (value: string, label: string): void => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`tessera:reproduction:invalid_${label}:${label} is empty`);
  }
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`tessera:reproduction:invalid_${label}:${label} must be a string`);
  }
  return value;
};

const assertArray = (value: unknown, label: string): void => {
  if (!Array.isArray(value)) {
    throw new Error(`tessera:reproduction:invalid_${label}:${label} must be an array`);
  }
};

const assertRelativePath = (path: string): void => {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`tessera:reproduction:invalid_artifact_path:${path}`);
  }
};

const validateCommandRecords = (commands: readonly unknown[]): void => {
  for (const rawCommand of commands) {
    if (!isRecord(rawCommand)) {
      throw new Error('tessera:reproduction:invalid_command:command must be an object');
    }
    const sequence = stringValue(rawCommand.sequence, 'command_sequence');
    assertNonEmpty(sequence, 'command_sequence');
    const submittedTick = stringValue(rawCommand.submittedTick, 'command_tick');
    assertNonEmpty(submittedTick, 'command_tick');
    const assignedTick = stringValue(rawCommand.assignedTick, 'assigned_tick');
    assertNonEmpty(assignedTick, 'assigned_tick');
    if (
      typeof rawCommand.exactTicks !== 'number' ||
      !Number.isSafeInteger(rawCommand.exactTicks) ||
      rawCommand.exactTicks < 0
    ) {
      throw new Error('tessera:reproduction:invalid_command_ticks:exact ticks are invalid');
    }
    if (!isRecord(rawCommand.payload)) {
      throw new Error('tessera:reproduction:invalid_command_payload:payload must be an object');
    }
  }
};

const validateArtifactReferences = (artifacts: readonly unknown[]): void => {
  for (const rawArtifact of artifacts) {
    if (!isRecord(rawArtifact)) {
      throw new Error('tessera:reproduction:invalid_artifact:artifact must be an object');
    }
    const path = stringValue(rawArtifact.path, 'artifact_path');
    assertRelativePath(path);
    const mediaType = stringValue(rawArtifact.mediaType, 'artifact_media_type');
    assertNonEmpty(mediaType, 'artifact_media_type');
  }
};

/** Validates the manifest boundary before it is written or replayed. */
export const validateReproductionManifest = (manifest: ReproductionBundleManifest): void => {
  if (!isRecord(manifest)) {
    throw new Error('tessera:reproduction:invalid_manifest:manifest must be an object');
  }
  if (manifest.format !== REPRODUCTION_BUNDLE_FORMAT) {
    throw new Error('tessera:reproduction:invalid_format:manifest format is unsupported');
  }
  if (manifest.version !== REPRODUCTION_BUNDLE_VERSION) {
    throw new Error(
      `tessera:reproduction:unsupported_version:manifest version ${manifest.version} is unsupported`,
    );
  }
  assertNonEmpty(manifest.scenarioId, 'scenario_id');
  assertNonEmpty(manifest.seedHex, 'seed');
  assertNonEmpty(manifest.frameworkVersion, 'framework_version');
  assertNonEmpty(manifest.gameId, 'game_id');
  if (!Number.isSafeInteger(manifest.protocolVersion) || manifest.protocolVersion < 1) {
    throw new Error('tessera:reproduction:invalid_protocol_version:protocol version is invalid');
  }
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    throw new Error('tessera:reproduction:invalid_schema_version:schema version is invalid');
  }
  assertArray(manifest.commands, 'commands');
  assertArray(manifest.snapshots, 'snapshots');
  assertArray(manifest.hashes, 'hashes');
  assertArray(manifest.errors, 'errors');
  assertArray(manifest.logs, 'logs');
  assertArray(manifest.artifacts, 'artifacts');
  if (!isRecord(manifest.metrics) || !isRecord(manifest.environment)) {
    throw new Error('tessera:reproduction:invalid_metadata:metrics and environment are required');
  }
  validateCommandRecords(manifest.commands);
  validateArtifactReferences(manifest.artifacts);
};

/** Creates a fresh manifest with stable format/version fields and copied arrays. */
export const createReproductionBundle = (
  input: ReproductionBundleInput,
): ReproductionBundleManifest => {
  const manifest: ReproductionBundleManifest = {
    format: REPRODUCTION_BUNDLE_FORMAT,
    version: REPRODUCTION_BUNDLE_VERSION,
    scenarioId: input.scenarioId,
    seedHex: input.seedHex,
    frameworkVersion: input.frameworkVersion,
    protocolVersion: input.protocolVersion,
    gameId: input.gameId,
    schemaVersion: input.schemaVersion,
    commands: input.commands.map((command) => ({
      ...command,
      payload: { ...command.payload },
    })),
    snapshots: input.snapshots.map((snapshot) => ({ ...snapshot })),
    hashes: input.hashes.map((hash) => ({ ...hash })),
    errors: input.errors.map((error) => ({ ...error })),
    logs: input.logs.map((log) => ({ ...log })),
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
    metrics: { ...input.metrics },
    environment: {
      ...input.environment,
      ...(input.environment.qualitySettings === undefined
        ? {}
        : { qualitySettings: { ...input.environment.qualitySettings } }),
      ...(input.environment.extra === undefined ? {} : { extra: { ...input.environment.extra } }),
    },
  };
  validateReproductionManifest(manifest);
  return manifest;
};

/** Serializes a manifest as the directory's human-readable `manifest.json`. */
export const serializeReproductionManifest = (manifest: ReproductionBundleManifest): string => {
  validateReproductionManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
};

/** Produces the manifest entry used by a directory writer or browser download. */
export const reproductionManifestEntry = (
  manifest: ReproductionBundleManifest,
): ReproductionDirectoryEntry => ({
  path: 'manifest.json',
  mediaType: 'application/json',
  bytes: new TextEncoder().encode(serializeReproductionManifest(manifest)),
});

/** Downloads only the manifest; other referenced artifacts remain separate files. */
export const downloadReproductionManifest = (
  manifest: ReproductionBundleManifest,
  filename = 'manifest.json',
): void => {
  exportSaveFile(reproductionManifestEntry(manifest).bytes, filename);
};

/** Parses and validates a manifest read from a reproduction directory. */
export const parseReproductionManifest = (text: string): ReproductionBundleManifest => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('tessera:reproduction:invalid_json:manifest JSON is invalid');
  }
  if (!isRecord(value)) {
    throw new Error('tessera:reproduction:invalid_json:manifest must be an object');
  }
  const manifest = value as unknown as ReproductionBundleManifest;
  validateReproductionManifest(manifest);
  return manifest;
};
