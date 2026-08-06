import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Rendering/outlineRenderer';
import './register-loaders.js';
import type {
  RenderEntityRecord,
  RenderGridCell,
  RenderSnapshotMetadata,
} from '../worker/data-protocol';
import { CameraProjection, type CameraViewport, type GridCoordinate } from './isometric-camera';
import type { PlacementPreview } from '../public/runtime-types';
import {
  reconcileVisualMappings,
  type VisualMapping,
  type VisualReconciliationOperation,
} from './visual-reconciliation';
import {
  boundsFromPoints,
  formatEntityId,
  parseEntityId,
  type EntityId,
  type ScreenBounds,
  type ScreenPoint,
} from './entity-selection';

/** Renderer-only counters exposed by the foundation runtime. */
export interface RendererDiagnostics {
  readonly renderFrames: number;
  readonly receivedSnapshots: number;
  readonly lastSnapshotGeneration: bigint;
  readonly lastWorldGeneration: number;
  readonly lastSimulationTick: bigint;
  readonly lastEntityCount: number;
  readonly occupiedCellCount?: number;
  readonly visibleEntityCount?: number;
  readonly staleMappingCount?: number;
  readonly staleSnapshotCount?: number;
  readonly resetCount?: number;
  readonly visualGroupCount?: number;
  readonly instanceCount?: number;
  readonly selectedEntityId?: EntityId;
  readonly disposed: boolean;
}

type EntityVisual = {
  readonly slot: number;
  generation: number;
  visualType: number;
  readonly mesh: InstancedMesh;
};

type SelectionListener = (entityId: EntityId | undefined) => void;

type GridBounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;

const gridBoundsForViewport = (
  cameraProjection: CameraProjection,
  viewport: CameraViewport,
  target: GridCoordinate,
): GridBounds => {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((screen) => cameraProjection.screenToWorld(screen, viewport, 0));
  const visibleCells = corners.flatMap((point) =>
    point === undefined ? [] : [cameraProjection.worldToGrid(point)],
  );
  if (visibleCells.length !== corners.length) {
    const fallbackHalfExtent = 8;
    return {
      minX: target.x - fallbackHalfExtent,
      maxX: target.x + fallbackHalfExtent,
      minZ: target.z - fallbackHalfExtent,
      maxZ: target.z + fallbackHalfExtent,
    };
  }
  const xs = visibleCells.map((cell) => cell.x);
  const zs = visibleCells.map((cell) => cell.z);
  return {
    minX: Math.min(...xs) - 1,
    maxX: Math.max(...xs) + 1,
    minZ: Math.min(...zs) - 1,
    maxZ: Math.max(...zs) + 1,
  };
};

/**
 * Babylon ownership for the foundation milestone.
 *
 * This class intentionally owns no authoritative entity state. It translates
 * immutable render snapshots into disposable Babylon visuals and keeps only
 * the presentation-side slot/generation mapping needed for picking.
 */
export class BabylonRenderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly light: HemisphericLight;
  private readonly entityMaterial: StandardMaterial;
  private readonly selectionOutlineColor: Color3;
  private readonly debugGridMaterial: StandardMaterial;
  private readonly occupiedMaterial: StandardMaterial;
  private readonly placementValidMaterial: StandardMaterial;
  private readonly placementInvalidMaterial: StandardMaterial;
  private readonly placementPreview: ReturnType<typeof MeshBuilder.CreateBox>;
  private readonly cameraProjection: CameraProjection;
  private readonly unsubscribeCamera: () => void;
  private debugGrid: LinesMesh | undefined;
  private debugGridKey = '';
  private occupiedVisuals: Array<ReturnType<typeof MeshBuilder.CreateBox>> = [];
  private readonly entityVisuals = new Map<number, EntityVisual>();
  private readonly visualsByMesh = new Map<AbstractMesh, EntityVisual>();
  private readonly selectionListeners = new Set<SelectionListener>();
  private disposed = false;
  private started = false;
  private renderFrames = 0;
  private receivedSnapshots = 0;
  private lastSnapshotGeneration = 0n;
  private lastWorldGeneration: number | undefined;
  private lastSimulationTick = 0n;
  private lastEntityCount = 0;
  private lastOccupiedCellCount = 0;
  private staleMappingCount = 0;
  private staleSnapshotCount = 0;
  private resetCount = 0;
  private selectedEntityId: EntityId | undefined;
  private readonly visualTemplates = new Map<number, Mesh>();
  private selectedEntityHandle: { readonly slot: number; readonly generation: number } | undefined;

  private readonly renderFrame = (): void => {
    if (!this.disposed) {
      this.scene.render();
    }
  };

  private readonly beforeRender = (): void => {
    this.renderFrames += 1;
  };

  private readonly resize = (): void => {
    if (!this.disposed) {
      this.engine.resize();
      this.syncCamera();
    }
  };

  public constructor(canvas: HTMLCanvasElement, cameraProjection?: CameraProjection) {
    if (!Engine.IsSupported) {
      throw new Error('tessera:renderer:webgl_unavailable:WebGL is not supported');
    }
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });
    if (engine.webGLVersion < 2) {
      engine.dispose();
      throw new Error('tessera:renderer:webgl2_unavailable:WebGL 2 is required');
    }
    this.engine = engine;
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.035, 0.047, 0.07, 1);

    this.cameraProjection = cameraProjection ?? new CameraProjection();
    this.camera = new FreeCamera('tessera-foundation-camera', new Vector3(0, 3, -6), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    this.scene.activeCamera = this.camera;
    this.light = new HemisphericLight(
      'tessera-foundation-light',
      new Vector3(0, 1, -0.25),
      this.scene,
    );
    this.light.intensity = 0.9;

    this.entityMaterial = new StandardMaterial('tessera-foundation-entity-material', this.scene);
    this.entityMaterial.diffuseColor = new Color3(0.22, 0.62, 0.92);
    this.selectionOutlineColor = new Color3(1, 0.68, 0.2);

    this.debugGridMaterial = new StandardMaterial('tessera-foundation-grid-material', this.scene);
    this.debugGridMaterial.emissiveColor = new Color3(0.12, 0.2, 0.3);
    this.debugGridMaterial.alpha = 0.55;
    this.debugGridMaterial.disableLighting = true;
    this.occupiedMaterial = new StandardMaterial(
      'tessera-foundation-occupied-material',
      this.scene,
    );
    this.occupiedMaterial.diffuseColor = new Color3(0.95, 0.45, 0.2);
    this.occupiedMaterial.emissiveColor = new Color3(0.25, 0.08, 0.02);
    this.occupiedMaterial.alpha = 0.32;
    this.occupiedMaterial.disableLighting = true;

    this.placementValidMaterial = new StandardMaterial(
      'tessera-placement-valid-material',
      this.scene,
    );
    this.placementValidMaterial.diffuseColor = new Color3(0.3, 0.9, 0.5);
    this.placementValidMaterial.emissiveColor = new Color3(0.06, 0.3, 0.12);
    this.placementValidMaterial.alpha = 0.42;
    this.placementValidMaterial.disableLighting = true;
    this.placementInvalidMaterial = new StandardMaterial(
      'tessera-placement-invalid-material',
      this.scene,
    );
    this.placementInvalidMaterial.diffuseColor = new Color3(0.95, 0.3, 0.25);
    this.placementInvalidMaterial.emissiveColor = new Color3(0.3, 0.05, 0.03);
    this.placementInvalidMaterial.alpha = 0.42;
    this.placementInvalidMaterial.disableLighting = true;
    this.placementPreview = MeshBuilder.CreateBox(
      'tessera-placement-preview',
      { size: 1 },
      this.scene,
    );
    this.placementPreview.isPickable = false;
    this.placementPreview.isVisible = false;

    this.unsubscribeCamera = this.cameraProjection.subscribe(this.syncCamera);

    this.scene.onBeforeRenderObservable.add(this.beforeRender);
    window.addEventListener('resize', this.resize);
    this.syncCamera();
  }

  /** Starts Babylon's render loop exactly once. */
  public start(): void {
    if (this.disposed || this.started) {
      return;
    }
    this.started = true;
    this.engine.runRenderLoop(this.renderFrame);
  }

  /**
   * Consumes only validated snapshot metadata. The bytes are already owned by
   * the caller and are returned to the Worker immediately after this method.
   */
  public consumeSnapshot(
    snapshot: RenderSnapshotMetadata,
    occupiedCells: readonly RenderGridCell[] = [],
    entities: readonly RenderEntityRecord[] = [],
  ): boolean {
    if (this.disposed) {
      throw new Error('tessera:renderer:disposed:cannot consume a snapshot after disposal');
    }
    this.receivedSnapshots += 1;
    const reconciliation = reconcileVisualMappings(
      {
        worldGeneration: this.lastWorldGeneration,
        snapshotGeneration: this.lastSnapshotGeneration,
        mappings: [...this.entityVisuals.values()].map((visual): VisualMapping => ({
          slot: visual.slot,
          generation: visual.generation,
          visualType: visual.visualType,
        })),
      },
      snapshot,
      entities,
    );
    if (!reconciliation.applied) {
      this.staleSnapshotCount += 1;
      return false;
    }
    if (reconciliation.reset) {
      this.resetVisuals();
      this.resetCount += 1;
    }
    this.lastSnapshotGeneration = snapshot.snapshotGeneration;
    this.lastWorldGeneration = snapshot.worldGeneration;
    this.lastSimulationTick = snapshot.simulationTick;
    this.lastEntityCount = snapshot.entityCount;
    this.staleMappingCount += reconciliation.staleMappingCount;
    this.applyVisualReconciliation(reconciliation.operations);
    this.updateOccupiedOverlay(occupiedCells);
    return true;
  }

  /** Returns the current selection after a canvas-relative pick. */
  public pick(point: ScreenPoint): EntityId | undefined {
    if (this.disposed) {
      return undefined;
    }
    const canvas = this.engine.getRenderingCanvas();
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return undefined;
    }
    const renderX = (point.x / bounds.width) * this.engine.getRenderWidth();
    const renderY = (point.y / bounds.height) * this.engine.getRenderHeight();
    const result = this.scene.pick(renderX, renderY, (mesh) => this.visualsByMesh.has(mesh));
    const visual = result.pickedMesh ? this.visualsByMesh.get(result.pickedMesh) : undefined;
    if (!result.hit || visual === undefined || this.entityVisuals.get(visual.slot) !== visual) {
      this.setSelection(undefined);
      return undefined;
    }
    const entityId = formatEntityId(visual);
    this.setSelection(entityId);
    return entityId;
  }

  public selectedEntity(): EntityId | undefined {
    return this.selectedEntityId;
  }

  public subscribeSelection(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    listener(this.selectedEntityId);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  /** Returns CSS-pixel bounds relative to the canvas for a current entity. */
  public screenBounds(entityId: EntityId): ScreenBounds | undefined {
    const handle = parseEntityId(entityId);
    if (handle === undefined) {
      return undefined;
    }
    const visual = this.entityVisuals.get(handle.slot);
    if (visual === undefined || visual.generation !== handle.generation) {
      return undefined;
    }
    const canvas = this.engine.getRenderingCanvas();
    const bounds = canvas?.getBoundingClientRect();
    const camera = this.scene.activeCamera;
    if (!bounds || camera === null) {
      return undefined;
    }
    const viewport = camera.viewport.toGlobal(
      this.engine.getRenderWidth(),
      this.engine.getRenderHeight(),
    );
    const points = visual.mesh.getBoundingInfo().boundingBox.vectorsWorld.map((corner) => {
      const projected = Vector3.Project(
        corner,
        visual.mesh.getWorldMatrix(),
        this.scene.getTransformMatrix(),
        viewport,
      );
      return {
        x: (projected.x / this.engine.getRenderWidth()) * bounds.width,
        y: (projected.y / this.engine.getRenderHeight()) * bounds.height,
      };
    });
    return boundsFromPoints(points);
  }

  /** Updates the presentation-only placement preview. */
  public setPlacementPreview(preview: PlacementPreview | undefined): void {
    if (this.disposed) {
      return;
    }
    if (preview === undefined) {
      this.placementPreview.isVisible = false;
      return;
    }
    const tileSize = this.cameraProjection.tileSizeMm / 1000;
    this.placementPreview.isVisible = true;
    this.placementPreview.position.set(
      (preview.x + 0.5) * tileSize,
      preview.elevationMm / 1000 + tileSize / 2,
      (preview.z + 0.5) * tileSize,
    );
    this.placementPreview.scaling.set(tileSize, tileSize, tileSize);
    this.placementPreview.rotation.y = (preview.rotation * Math.PI) / 2;
    this.placementPreview.material =
      preview.pending || !preview.valid
        ? this.placementInvalidMaterial
        : this.placementValidMaterial;
  }

  public diagnostics(): RendererDiagnostics {
    return {
      renderFrames: this.renderFrames,
      receivedSnapshots: this.receivedSnapshots,
      lastSnapshotGeneration: this.lastSnapshotGeneration,
      lastWorldGeneration: this.lastWorldGeneration ?? 0,
      lastSimulationTick: this.lastSimulationTick,
      lastEntityCount: this.lastEntityCount,
      occupiedCellCount: this.lastOccupiedCellCount,
      visibleEntityCount: this.entityVisuals.size,
      staleMappingCount: this.staleMappingCount,
      staleSnapshotCount: this.staleSnapshotCount,
      resetCount: this.resetCount,
      visualGroupCount: this.visualTemplates.size,
      instanceCount: this.entityVisuals.size,
      ...(this.selectedEntityId === undefined ? {} : { selectedEntityId: this.selectedEntityId }),
      disposed: this.disposed,
    };
  }

  /** Disposes every Babylon resource and is safe to call repeatedly. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.engine.stopRenderLoop(this.renderFrame);
    this.scene.onBeforeRenderObservable.removeCallback(this.beforeRender);
    window.removeEventListener('resize', this.resize);
    this.unsubscribeCamera();
    this.debugGrid?.dispose();
    this.debugGrid = undefined;
    this.resetVisuals();
    this.selectionListeners.clear();
    this.entityMaterial.dispose();
    this.debugGridMaterial.dispose();
    this.occupiedMaterial.dispose();
    this.placementPreview.dispose(false, true);
    this.placementValidMaterial.dispose();
    this.placementInvalidMaterial.dispose();
    this.light.dispose();
    this.camera.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly viewport = (): CameraViewport => {
    const canvas = this.engine.getRenderingCanvas();
    const bounds = canvas?.getBoundingClientRect();
    return {
      width: Math.max(1, bounds?.width ?? this.engine.getRenderWidth()),
      height: Math.max(1, bounds?.height ?? this.engine.getRenderHeight()),
    };
  };

  private readonly syncCamera = (): void => {
    if (this.disposed) {
      return;
    }
    const viewport = this.viewport();
    const pose = this.cameraProjection.pose();
    const target = new Vector3(
      pose.targetMm.xMm / 1000,
      pose.targetMm.yMm / 1000,
      pose.targetMm.zMm / 1000,
    );
    this.camera.position.copyFrom(
      new Vector3(
        pose.positionMm.xMm / 1000,
        pose.positionMm.yMm / 1000,
        pose.positionMm.zMm / 1000,
      ),
    );
    this.camera.setTarget(target);
    const bounds = this.cameraProjection.orthographicBounds(viewport);
    this.camera.orthoLeft = bounds.left / 1000;
    this.camera.orthoRight = bounds.right / 1000;
    this.camera.orthoTop = bounds.top / 1000;
    this.camera.orthoBottom = bounds.bottom / 1000;
    this.camera.maxZ = Math.max(1000, (pose.distanceMm / 1000) * 4);
    this.updateDebugGrid();
  };

  private readonly updateDebugGrid = (): void => {
    if (this.disposed) {
      return;
    }
    const viewport = this.viewport();
    const target = this.cameraProjection.worldToGrid(this.cameraProjection.state.targetMm);
    const bounds = gridBoundsForViewport(this.cameraProjection, viewport, target);
    const key = `${bounds.minX}:${bounds.maxX}:${bounds.minZ}:${bounds.maxZ}:${this.cameraProjection.tileSizeMm}`;
    if (this.debugGridKey === key && this.debugGrid !== undefined) {
      return;
    }
    this.debugGridKey = key;
    this.debugGrid?.dispose();
    const tileSize = this.cameraProjection.tileSizeMm / 1000;
    const lines: Vector3[][] = [];
    for (let x = bounds.minX; x <= bounds.maxX + 1; x += 1) {
      lines.push([
        new Vector3(x * tileSize, 0.002, bounds.minZ * tileSize),
        new Vector3(x * tileSize, 0.002, (bounds.maxZ + 1) * tileSize),
      ]);
    }
    for (let z = bounds.minZ; z <= bounds.maxZ + 1; z += 1) {
      lines.push([
        new Vector3(bounds.minX * tileSize, 0.002, z * tileSize),
        new Vector3((bounds.maxX + 1) * tileSize, 0.002, z * tileSize),
      ]);
    }
    this.debugGrid = MeshBuilder.CreateLineSystem(
      'tessera-foundation-debug-grid',
      { lines },
      this.scene,
    );
    this.debugGrid.color = this.debugGridMaterial.emissiveColor;
    this.debugGrid.isPickable = false;
  };

  private readonly updateOccupiedOverlay = (cells: readonly RenderGridCell[]): void => {
    if (this.disposed) {
      return;
    }
    this.disposeOccupiedVisuals();
    const tileSize = this.cameraProjection.tileSizeMm / 1000;
    for (const cell of cells) {
      const visual = MeshBuilder.CreateBox(
        `tessera-foundation-occupied-${cell.x}-${cell.z}-${cell.elevationMm}`,
        { width: tileSize, depth: tileSize, height: 0.04 },
        this.scene,
      );
      visual.position.set(
        (cell.x + 0.5) * tileSize,
        cell.elevationMm / 1000 + 0.02,
        (cell.z + 0.5) * tileSize,
      );
      visual.material = this.occupiedMaterial;
      visual.isPickable = false;
      this.occupiedVisuals.push(visual);
    }
    this.lastOccupiedCellCount = cells.length;
  };

  private readonly disposeOccupiedVisuals = (): void => {
    for (const visual of this.occupiedVisuals) {
      visual.dispose(false, false);
    }
    this.occupiedVisuals = [];
    this.lastOccupiedCellCount = 0;
  };

  private readonly applyVisualReconciliation = (
    operations: readonly VisualReconciliationOperation[],
  ): void => {
    for (const operation of operations) {
      this.applyVisualReconciliationOperation(operation);
    }
    if (this.selectedEntityHandle !== undefined && !this.hasSelectedVisual()) {
      this.setSelection(undefined);
    }
  };

  private readonly applyVisualReconciliationOperation = (
    operation: VisualReconciliationOperation,
  ): void => {
    if (operation.type === 'create') {
      this.createEntityVisual(operation.entity);
      return;
    }
    const visual = this.entityVisuals.get(
      operation.type === 'update' ? operation.entity.slot : operation.previous.slot,
    );
    if (operation.type === 'update') {
      if (visual === undefined) {
        this.staleMappingCount += 1;
        this.createEntityVisual(operation.entity);
      } else {
        this.updateEntityVisual(visual, operation.entity);
      }
      return;
    }
    if (visual !== undefined) {
      this.removeEntityVisual(visual);
    }
    if (operation.type === 'replace') {
      this.createEntityVisual(operation.entity);
    }
  };

  private readonly createVisualTemplate = (visualType: number): Mesh => {
    const template = MeshBuilder.CreateBox(
      `tessera-visual-type-${visualType}`,
      { size: 1 },
      this.scene,
    );
    template.material = this.entityMaterial;
    template.isPickable = false;
    template.isVisible = false;
    this.visualTemplates.set(visualType, template);
    return template;
  };

  private readonly createEntityVisual = (entity: RenderEntityRecord): EntityVisual => {
    const template =
      this.visualTemplates.get(entity.visualType) ?? this.createVisualTemplate(entity.visualType);
    const mesh = template.createInstance(`tessera-entity-${entity.slot}`);
    mesh.isPickable = true;
    mesh.isVisible = true;
    mesh.renderOutline = false;
    mesh.outlineColor = this.selectionOutlineColor;
    mesh.outlineWidth = 0.05;
    mesh.rotationQuaternion = Quaternion.Identity();
    const visual: EntityVisual = {
      slot: entity.slot,
      generation: entity.generation,
      visualType: entity.visualType,
      mesh,
    };
    this.entityVisuals.set(entity.slot, visual);
    this.visualsByMesh.set(mesh, visual);
    this.updateEntityVisual(visual, entity);
    return visual;
  };

  private readonly updateEntityVisual = (
    visual: EntityVisual,
    entity: RenderEntityRecord,
  ): void => {
    const tileSize = this.cameraProjection.tileSizeMm / 1000;
    visual.mesh.position.set(
      (entity.x + 0.5) * tileSize,
      entity.elevationMm / 1000 + (entity.scale.y * tileSize) / 2,
      (entity.z + 0.5) * tileSize,
    );
    visual.mesh.scaling.set(
      entity.scale.x * tileSize,
      entity.scale.y * tileSize,
      entity.scale.z * tileSize,
    );
    visual.mesh.rotationQuaternion?.set(
      entity.rotation.x,
      entity.rotation.y,
      entity.rotation.z,
      entity.rotation.w,
    );
    visual.mesh.renderOutline = this.isSelected(visual);
  };

  private readonly removeEntityVisual = (visual: EntityVisual): void => {
    if (this.isSelected(visual)) {
      this.setSelection(undefined);
    }
    this.entityVisuals.delete(visual.slot);
    this.visualsByMesh.delete(visual.mesh);
    visual.mesh.dispose(false, false);
  };

  private readonly resetVisuals = (): void => {
    this.setSelection(undefined);
    for (const visual of this.entityVisuals.values()) {
      visual.mesh.dispose(false, false);
    }
    this.entityVisuals.clear();
    this.visualsByMesh.clear();
    for (const template of this.visualTemplates.values()) {
      template.dispose(false, true);
    }
    this.visualTemplates.clear();
    this.disposeOccupiedVisuals();
  };

  private readonly isSelected = (visual: EntityVisual): boolean =>
    this.selectedEntityHandle?.slot === visual.slot &&
    this.selectedEntityHandle.generation === visual.generation;

  private readonly hasSelectedVisual = (): boolean =>
    this.selectedEntityHandle !== undefined &&
    this.entityVisuals.get(this.selectedEntityHandle.slot)?.generation ===
      this.selectedEntityHandle.generation;

  private readonly setSelection = (entityId: EntityId | undefined): void => {
    if (this.selectedEntityId === entityId) {
      return;
    }
    if (this.selectedEntityHandle !== undefined) {
      this.setVisualSelection(this.selectedEntityHandle, false);
    }
    this.selectedEntityId = entityId;
    this.selectedEntityHandle = entityId === undefined ? undefined : parseEntityId(entityId);
    if (this.selectedEntityHandle !== undefined) {
      this.setVisualSelection(this.selectedEntityHandle, true);
    }
    for (const listener of this.selectionListeners) {
      listener(entityId);
    }
  };

  private readonly setVisualSelection = (
    handle: { readonly slot: number; readonly generation: number },
    selected: boolean,
  ): void => {
    const visual = this.entityVisuals.get(handle.slot);
    if (visual !== undefined && visual.generation === handle.generation) {
      visual.mesh.renderOutline = selected;
    }
  };

  private readonly clearSelection = (): void => {
    this.setSelection(undefined);
  };
}
