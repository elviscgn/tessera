import type {
  FoundationReady,
  FoundationDiagnostics,
  FoundationRenderInspection,
  FoundationRuntime,
} from '../browser/foundation-runtime';
import { viewportForCanvas } from '../browser/canvas-viewport';
import type { BoundaryMetrics, CommandResultResponse } from '../worker/bridge-protocol';
import type { CameraState, GridCoordinate } from '../renderer/isometric-camera';
import type { EntityId, ScreenBounds, ScreenPoint } from '../renderer/entity-selection';
import type {
  EntityTransformTarget,
  LoadResult,
  PlacementTarget,
  PlacementValidation,
  ScenarioDefinition,
} from '../public/runtime-types';
import {
  buildAnnotatedOverlayCapture,
  createAnnotatedOverlay,
  normalizeAnnotatedOverlayOptions,
  type AnnotatedOverlayCapture,
  type AnnotatedOverlayController,
  type AnnotatedOverlayOptions,
  type NormalizedAnnotatedOverlayOptions,
} from './annotated-overlay';
import {
  createReproductionBundle,
  type ReproductionArtifactReference,
  type ReproductionBundleInput,
  type ReproductionBundleManifest,
  type ReproductionEnvironment,
  type ReproductionErrorRecord,
  type ReproductionHashRecord,
  type ReproductionLogRecord,
  type ReproductionSnapshotRecord,
} from './reproduction-bundle';

export interface TesseraTestBridgeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scenario?: ScenarioDefinition;
  readonly scenarios?: readonly ScenarioDefinition[];
  readonly seedHex?: string;
  readonly frameworkVersion?: string;
  readonly protocolVersion?: number;
  readonly gameId?: string;
  readonly schemaVersion?: number;
  readonly overlay?: AnnotatedOverlayOptions;
  readonly environment?: ReproductionEnvironment;
}

export interface TestEntityRecord {
  readonly id: EntityId;
  readonly slot: number;
  readonly generation: number;
  readonly x: number;
  readonly z: number;
  readonly elevationMm: number;
  readonly visualType: number;
  readonly renderFlags: number;
}

export interface TestSynchronizationState {
  readonly simulationTick: string;
  readonly renderedTick: string;
  readonly renderGeneration: string;
  readonly eventSequence: string;
  readonly eventDesynced: boolean;
  readonly metrics?: BoundaryMetrics;
}

export interface ReproductionCaptureOverrides {
  readonly snapshots?: readonly ReproductionSnapshotRecord[];
  readonly hashes?: readonly ReproductionHashRecord[];
  readonly errors?: readonly ReproductionErrorRecord[];
  readonly logs?: readonly ReproductionLogRecord[];
  readonly artifacts?: readonly ReproductionArtifactReference[];
  readonly metrics?: Readonly<Record<string, number | string | boolean>>;
  readonly environment?: ReproductionEnvironment;
}

const defaultSeedHex = (): string => '07'.repeat(32);

const cloneEntity = (entity: TestEntityRecord): TestEntityRecord => ({ ...entity });

const scenarioListFor = (options: TesseraTestBridgeOptions): readonly ScenarioDefinition[] =>
  (options.scenarios ?? [options.scenario ?? { id: 'default' }]).map((scenario) => ({
    ...scenario,
  }));

const environmentFor = (options: TesseraTestBridgeOptions): ReproductionEnvironment => {
  const viewport = viewportForCanvas(options.canvas);
  const browserDetails = typeof navigator === 'undefined' ? {} : { userAgent: navigator.userAgent };
  const displayDetails =
    typeof window === 'undefined' ? {} : { devicePixelRatio: window.devicePixelRatio };
  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    ...browserDetails,
    ...displayDetails,
    ...options.environment,
  };
};

const overlayFor = (
  runtime: FoundationRuntime,
  options: TesseraTestBridgeOptions,
): AnnotatedOverlayController => {
  if (typeof document !== 'undefined' && options.canvas.parentElement !== null) {
    return createAnnotatedOverlay(runtime, options.canvas, options.overlay);
  }
  return noOpOverlay(runtime, options.canvas, options.overlay ?? {});
};

const noOpOverlay = (
  runtime: FoundationRuntime,
  canvas: HTMLCanvasElement,
  initialOptions: AnnotatedOverlayOptions,
): AnnotatedOverlayController => {
  let options = normalizeAnnotatedOverlayOptions(initialOptions);
  return {
    get options(): NormalizedAnnotatedOverlayOptions {
      return { ...options };
    },
    setOptions(next): NormalizedAnnotatedOverlayOptions {
      options = normalizeAnnotatedOverlayOptions(next);
      return { ...options };
    },
    capture(): AnnotatedOverlayCapture {
      const inspection = runtime.renderInspection();
      const viewport = viewportForCanvas(canvas);
      return buildAnnotatedOverlayCapture({
        options,
        camera: runtime.camera.state,
        viewport,
        diagnostics: runtime.diagnostics(),
        entities: inspection.entities,
        occupiedCells: inspection.occupiedCells,
      });
    },
    dispose(): void {
      // No DOM was available at registration time.
    },
  };
};

const defaultSnapshot = (
  diagnostics: FoundationDiagnostics,
  inspection: FoundationRenderInspection,
): ReproductionSnapshotRecord => ({
  tick: diagnostics.lastRenderTick.toString(),
  snapshotGeneration: diagnostics.lastSnapshotGeneration.toString(),
  worldGeneration: diagnostics.renderer.lastWorldGeneration,
  entityCount: inspection.entities.length,
  occupiedCellCount: inspection.occupiedCells.length,
});

const defaultHashes = (diagnostics: FoundationDiagnostics): readonly ReproductionHashRecord[] =>
  diagnostics.lastStateHashHex === undefined
    ? []
    : [
        {
          tick: diagnostics.simulationTick.toString(),
          stateHashHex: diagnostics.lastStateHashHex,
        },
      ];

const defaultErrors = (
  diagnostics: FoundationDiagnostics,
  recorded: readonly ReproductionErrorRecord[],
): readonly ReproductionErrorRecord[] => [
  ...(diagnostics.lastError === undefined
    ? []
    : [
        {
          phase: diagnostics.lastError.phase,
          code: diagnostics.lastError.code,
          message: diagnostics.lastError.message,
          tick: diagnostics.simulationTick.toString(),
        },
      ]),
  ...recorded,
];

const numericMetrics = (
  diagnostics: FoundationDiagnostics,
): Readonly<Record<string, number | string | boolean>> =>
  diagnostics.metrics === undefined ? {} : Object.fromEntries(Object.entries(diagnostics.metrics));

/**
 * Development-only, read-only inspection and command facade. It deliberately
 * exposes validated queries and the same public command methods a consumer
 * uses; it never exposes the Worker, Wasm memory, or a mutable simulation.
 */
export class TesseraTestBridge {
  public readonly ready: Promise<FoundationReady>;
  public readonly camera: {
    readonly state: () => CameraState;
    readonly setState: (state: CameraState) => void;
    readonly focusGrid: (cell: GridCoordinate, elevationMm: number) => void;
  };
  public readonly overlay: AnnotatedOverlayController;

  private readonly runtime: FoundationRuntime;
  private readonly scenarioId: string;
  private readonly scenariosList: readonly ScenarioDefinition[];
  private readonly seedHex: string;
  private readonly frameworkVersion: string;
  private readonly protocolVersion: number;
  private readonly gameId: string;
  private readonly schemaVersion: number;
  private readonly environment: ReproductionEnvironment;
  private readonly commandRecords: ReproductionBundleInput['commands'][number][] = [];
  private readonly errors: ReproductionErrorRecord[] = [];
  private readonly logs: ReproductionLogRecord[] = [];
  private pausedState = false;
  private disposed = false;
  private readonly initialSave: Promise<Uint8Array>;

  public constructor(runtime: FoundationRuntime, options: TesseraTestBridgeOptions) {
    this.runtime = runtime;
    this.ready = runtime.ready;
    this.scenarioId = options.scenario?.id ?? 'default';
    this.scenariosList = scenarioListFor(options);
    this.seedHex = options.seedHex ?? defaultSeedHex();
    this.frameworkVersion = options.frameworkVersion ?? '0.0.0';
    this.protocolVersion = options.protocolVersion ?? 1;
    this.gameId = options.gameId ?? 'tessera';
    this.schemaVersion = options.schemaVersion ?? 1;
    this.environment = environmentFor(options);
    this.camera = {
      state: () => this.runtime.camera.state,
      setState: (state) => this.runtime.camera.setState(state),
      focusGrid: (cell, elevationMm) => this.runtime.camera.focusGrid(cell, elevationMm),
    };
    this.overlay = overlayFor(runtime, options);
    this.initialSave = this.runtime.ready.then(() => this.runtime.save());
    void this.initialSave.catch(() => undefined);
  }

  public diagnostics(): FoundationDiagnostics {
    return this.runtime.diagnostics();
  }

  public requestMetrics(): Promise<BoundaryMetrics> {
    return this.runtime.requestMetrics();
  }

  public renderInspection(): FoundationRenderInspection {
    return this.runtime.renderInspection();
  }

  public entities(): readonly TestEntityRecord[] {
    return this.runtime
      .renderInspection()
      .entities.map((entity) => ({
        id: `${entity.slot}:${entity.generation}`,
        slot: entity.slot,
        generation: entity.generation,
        x: entity.x,
        z: entity.z,
        elevationMm: entity.elevationMm,
        visualType: entity.visualType,
        renderFlags: entity.renderFlags,
      }))
      .map(cloneEntity);
  }

  public entity(entityId: EntityId): TestEntityRecord | undefined {
    return this.entities().find((entity) => entity.id === entityId);
  }

  public occupiedCells(): FoundationRenderInspection['occupiedCells'] {
    return this.runtime.renderInspection().occupiedCells.map((cell) => ({ ...cell }));
  }

  public visibleEntityIds(): readonly EntityId[] {
    return this.entities().map((entity) => entity.id);
  }

  public screenBounds(entityId: EntityId): ScreenBounds | undefined {
    return this.runtime.screenBounds(entityId);
  }

  public pick(point: ScreenPoint): EntityId | undefined {
    return this.runtime.pick(point);
  }

  public selectedEntity(): EntityId | undefined {
    return this.runtime.selectedEntity();
  }

  public synchronization(): TestSynchronizationState {
    const diagnostics = this.runtime.diagnostics();
    return {
      simulationTick: diagnostics.simulationTick.toString(),
      renderedTick: diagnostics.lastRenderTick.toString(),
      renderGeneration: diagnostics.lastSnapshotGeneration.toString(),
      eventSequence: diagnostics.eventStream.highestContiguousSequence.toString(),
      eventDesynced: diagnostics.eventStream.desynced,
      ...(diagnostics.metrics === undefined ? {} : { metrics: diagnostics.metrics }),
    };
  }

  public waitForReady(): Promise<FoundationReady> {
    return this.runtime.ready;
  }

  public waitForSimulationTick(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.runtime.waitForSimulationTick(target);
  }

  public waitForRenderedTick(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.runtime.waitForRenderedTick(target);
  }

  public waitForRenderGeneration(target: number | bigint): Promise<FoundationDiagnostics> {
    return this.runtime.waitForRenderGeneration(target);
  }

  public waitForNoPendingErrors(): Promise<FoundationDiagnostics> {
    return this.runtime.waitForNoPendingErrors();
  }

  public waitForCommandReceipt(
    receipt: Promise<CommandResultResponse>,
  ): Promise<CommandResultResponse> {
    return this.runtime.waitForCommandReceipt(receipt);
  }

  public pause(): void {
    this.pausedState = true;
  }

  public resume(): void {
    this.pausedState = false;
  }

  public isPaused(): boolean {
    return this.pausedState;
  }

  public step(exactTicks = 1): Promise<CommandResultResponse> {
    if (!this.pausedState) {
      return Promise.reject(new Error('tessera:testkit:step_requires_pause:pause before stepping'));
    }
    return this.recordCommand(
      'raw',
      { action: 'step' },
      exactTicks,
      () => this.runtime.step(exactTicks),
      '0',
    );
  }

  public validatePlacement(target: PlacementTarget): Promise<PlacementValidation> {
    return this.runtime.validatePlacement(target);
  }

  public placeObject(target: PlacementTarget, exactTicks = 1): Promise<CommandResultResponse> {
    return this.recordCommand(
      'place',
      {
        objectType: target.objectType,
        x: target.x,
        z: target.z,
        elevationMm: target.elevationMm,
        rotation: target.rotation,
      },
      exactTicks,
      () => this.runtime.placeObject(target, exactTicks),
    );
  }

  public moveObject(
    entityId: EntityId,
    target: EntityTransformTarget,
    exactTicks = 1,
  ): Promise<CommandResultResponse> {
    return this.recordCommand(
      'move',
      {
        entityId,
        x: target.x,
        z: target.z,
        elevationMm: target.elevationMm,
        rotation: target.rotation,
      },
      exactTicks,
      () => this.runtime.moveObject(entityId, target, exactTicks),
    );
  }

  public removeEntity(entityId: EntityId, exactTicks = 1): Promise<CommandResultResponse> {
    return this.recordCommand('remove', { entityId }, exactTicks, () =>
      this.runtime.removeEntity(entityId, exactTicks),
    );
  }

  public save(): Promise<Uint8Array> {
    return this.runtime.save();
  }

  public load(bytes: ArrayBuffer | Uint8Array): Promise<LoadResult> {
    return this.runtime.load(bytes);
  }

  public listScenarios(): readonly ScenarioDefinition[] {
    return this.scenariosList.map((scenario) => ({ ...scenario }));
  }

  public async loadScenario(id: string): Promise<LoadResult> {
    if (!this.scenariosList.some((scenario) => scenario.id === id)) {
      throw new Error(`tessera:testkit:unknown_scenario:${id}`);
    }
    if (id !== this.scenarioId) {
      throw new Error(
        `tessera:testkit:scenario_restart_only:runtime was initialized for ${this.scenarioId}`,
      );
    }
    return this.reset();
  }

  public async reset(): Promise<LoadResult> {
    const bytes = await this.initialSave;
    this.pausedState = true;
    return this.runtime.load(bytes);
  }

  public captureReproductionBundle(
    overrides: ReproductionCaptureOverrides = {},
  ): ReproductionBundleManifest {
    const diagnostics = this.runtime.diagnostics();
    const inspection = this.runtime.renderInspection();
    const snapshots = overrides.snapshots ?? [defaultSnapshot(diagnostics, inspection)];
    const hashes = overrides.hashes ?? defaultHashes(diagnostics);
    const errors = overrides.errors ?? defaultErrors(diagnostics, this.errors);
    const metrics = overrides.metrics ?? numericMetrics(diagnostics);
    return createReproductionBundle({
      scenarioId: this.scenarioId,
      seedHex: this.seedHex,
      frameworkVersion: this.frameworkVersion,
      protocolVersion: this.protocolVersion,
      gameId: this.gameId,
      schemaVersion: this.schemaVersion,
      commands: this.commandRecords,
      snapshots,
      hashes,
      errors,
      logs: overrides.logs ?? this.logs,
      artifacts: overrides.artifacts ?? [],
      metrics,
      environment: { ...this.environment, ...overrides.environment },
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.overlay.dispose();
  }

  private recordCommand<T extends CommandResultResponse>(
    kind: 'place' | 'move' | 'remove' | 'raw',
    payload: Readonly<Record<string, number | string>>,
    exactTicks: number,
    operation: () => Promise<T>,
    sequence = this.runtime.nextClientSequence().toString(),
  ): Promise<T> {
    const record = {
      kind,
      sequence,
      submittedTick: this.runtime.diagnostics().simulationTick.toString(),
      assignedTick: (this.runtime.diagnostics().simulationTick + 1n).toString(),
      exactTicks,
      payload: { ...payload },
    };
    this.commandRecords.push(record);
    const promise = operation();
    void promise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.push({
        phase: 'command',
        code: 'command_rejected',
        message,
        tick: this.runtime.diagnostics().simulationTick.toString(),
      });
    });
    return promise;
  }
}

export type TesseraTestBridgeDisposer = () => void;

/** Registers the test facade only in a development build. */
export const registerTesseraTestBridge = (
  runtime: FoundationRuntime,
  options: TesseraTestBridgeOptions,
): TesseraTestBridgeDisposer => {
  if (import.meta.env.PROD) {
    throw new Error('tessera:testkit:production_disabled:test bridge is development-only');
  }
  const hostWindow = globalThis.window;
  if (hostWindow === undefined) {
    throw new Error('tessera:testkit:window_unavailable:test bridge requires a browser window');
  }
  if (hostWindow.tesseraTest !== undefined) {
    throw new Error('tessera:testkit:already_registered:window.tesseraTest is already occupied');
  }
  const bridge = new TesseraTestBridge(runtime, options);
  hostWindow.tesseraTest = bridge;
  return (): void => {
    if (hostWindow.tesseraTest === bridge) {
      delete hostWindow.tesseraTest;
    }
    bridge.dispose();
  };
};

declare global {
  interface Window {
    tesseraTest?: TesseraTestBridge;
  }
}
