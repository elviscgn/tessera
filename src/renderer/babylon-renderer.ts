import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
import './register-loaders.js';
import type {
  RenderEntityRecord,
  RenderGridCell,
  RenderSnapshotMetadata,
} from '../worker/data-protocol';
import { CameraProjection, type CameraViewport } from './isometric-camera';
import type { PlacementPreview } from '../public/runtime-types';
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
  readonly lastSimulationTick: bigint;
  readonly lastEntityCount: number;
  readonly occupiedCellCount?: number;
  readonly visibleEntityCount?: number;
  readonly staleMappingCount?: number;
  readonly selectedEntityId?: EntityId;
  readonly disposed: boolean;
}

type EntityVisual = {
  readonly slot: number;
  generation: number;
  readonly mesh: ReturnType<typeof MeshBuilder.CreateBox>;
};

type SelectionListener = (entityId: EntityId | undefined) => void;

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
  private readonly placeholder: ReturnType<typeof MeshBuilder.CreateBox>;
  private readonly placeholderMaterial: StandardMaterial;
  private readonly entityMaterial: StandardMaterial;
  private readonly selectedMaterial: StandardMaterial;
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
  private lastSimulationTick = 0n;
  private lastEntityCount = 0;
  private lastOccupiedCellCount = 0;
  private staleMappingCount = 0;
  private selectedEntityId: EntityId | undefined;

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

    this.placeholder = MeshBuilder.CreateBox(
      'tessera-foundation-placeholder',
      { size: 1 },
      this.scene,
    );
    this.placeholder.position.y = 0.5;
    this.placeholderMaterial = new StandardMaterial(
      'tessera-foundation-placeholder-material',
      this.scene,
    );
    this.placeholderMaterial.diffuseColor = new Color3(0.22, 0.62, 0.92);
    this.placeholder.material = this.placeholderMaterial;
    this.placeholder.isPickable = false;

    this.entityMaterial = new StandardMaterial('tessera-foundation-entity-material', this.scene);
    this.entityMaterial.diffuseColor = new Color3(0.22, 0.62, 0.92);
    this.selectedMaterial = new StandardMaterial(
      'tessera-foundation-selected-material',
      this.scene,
    );
    this.selectedMaterial.diffuseColor = new Color3(1, 0.68, 0.2);
    this.selectedMaterial.emissiveColor = new Color3(0.35, 0.16, 0.02);

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
  ): void {
    if (this.disposed) {
      throw new Error('tessera:renderer:disposed:cannot consume a snapshot after disposal');
    }
    this.receivedSnapshots += 1;
    this.lastSnapshotGeneration = snapshot.snapshotGeneration;
    this.lastSimulationTick = snapshot.simulationTick;
    this.lastEntityCount = snapshot.entityCount;
    this.syncEntityVisuals(entities);
    this.updateOccupiedOverlay(occupiedCells);
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
      lastSimulationTick: this.lastSimulationTick,
      lastEntityCount: this.lastEntityCount,
      occupiedCellCount: this.lastOccupiedCellCount,
      visibleEntityCount: this.entityVisuals.size,
      staleMappingCount: this.staleMappingCount,
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
    this.disposeOccupiedVisuals();
    this.clearSelection();
    for (const visual of this.entityVisuals.values()) {
      visual.mesh.dispose(false, false);
    }
    this.entityVisuals.clear();
    this.visualsByMesh.clear();
    this.placeholder.dispose(false, true);
    this.placeholderMaterial.dispose();
    this.entityMaterial.dispose();
    this.selectedMaterial.dispose();
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
    const target = this.cameraProjection.worldToGrid(this.cameraProjection.state.targetMm);
    const halfExtent = 8;
    const key = `${target.x}:${target.z}:${this.cameraProjection.tileSizeMm}`;
    if (this.debugGridKey === key && this.debugGrid !== undefined) {
      return;
    }
    this.debugGridKey = key;
    this.debugGrid?.dispose();
    const tileSize = this.cameraProjection.tileSizeMm / 1000;
    const minX = target.x - halfExtent;
    const maxX = target.x + halfExtent;
    const minZ = target.z - halfExtent;
    const maxZ = target.z + halfExtent;
    const lines: Vector3[][] = [];
    for (let x = minX; x <= maxX + 1; x += 1) {
      lines.push([
        new Vector3(x * tileSize, 0.002, minZ * tileSize),
        new Vector3(x * tileSize, 0.002, (maxZ + 1) * tileSize),
      ]);
    }
    for (let z = minZ; z <= maxZ + 1; z += 1) {
      lines.push([
        new Vector3(minX * tileSize, 0.002, z * tileSize),
        new Vector3((maxX + 1) * tileSize, 0.002, z * tileSize),
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

  private readonly syncEntityVisuals = (entities: readonly RenderEntityRecord[]): void => {
    const seenSlots = new Set<number>();
    for (const entity of entities) {
      seenSlots.add(entity.slot);
      const existing = this.entityVisuals.get(entity.slot);
      if (existing !== undefined && existing.generation !== entity.generation) {
        this.staleMappingCount += 1;
        this.removeEntityVisual(existing);
      }
      const visual = this.entityVisuals.get(entity.slot) ?? this.createEntityVisual(entity);
      visual.generation = entity.generation;
      this.updateEntityVisual(visual, entity);
    }
    for (const visual of this.entityVisuals.values()) {
      if (!seenSlots.has(visual.slot)) {
        this.removeEntityVisual(visual);
      }
    }
    if (
      this.selectedEntityId !== undefined &&
      this.screenBounds(this.selectedEntityId) === undefined
    ) {
      this.setSelection(undefined);
    }
  };

  private readonly createEntityVisual = (entity: RenderEntityRecord): EntityVisual => {
    const mesh = MeshBuilder.CreateBox(`tessera-entity-${entity.slot}`, { size: 1 }, this.scene);
    mesh.material = this.entityMaterial;
    mesh.isPickable = true;
    const visual: EntityVisual = { slot: entity.slot, generation: entity.generation, mesh };
    this.entityVisuals.set(entity.slot, visual);
    this.visualsByMesh.set(mesh, visual);
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
    visual.mesh.rotationQuaternion = new Quaternion(
      entity.rotation.x,
      entity.rotation.y,
      entity.rotation.z,
      entity.rotation.w,
    );
    visual.mesh.material =
      this.selectedEntityId === formatEntityId(visual)
        ? this.selectedMaterial
        : this.entityMaterial;
  };

  private readonly removeEntityVisual = (visual: EntityVisual): void => {
    if (this.selectedEntityId === formatEntityId(visual)) {
      this.setSelection(undefined);
    }
    this.entityVisuals.delete(visual.slot);
    this.visualsByMesh.delete(visual.mesh);
    visual.mesh.dispose(false, false);
  };

  private readonly setSelection = (entityId: EntityId | undefined): void => {
    if (this.selectedEntityId === entityId) {
      return;
    }
    this.setVisualMaterial(this.selectedEntityId, this.entityMaterial);
    this.selectedEntityId = entityId;
    this.setVisualMaterial(entityId, this.selectedMaterial);
    for (const listener of this.selectionListeners) {
      listener(entityId);
    }
  };

  private readonly setVisualMaterial = (
    entityId: EntityId | undefined,
    material: StandardMaterial,
  ): void => {
    const handle = entityId === undefined ? undefined : parseEntityId(entityId);
    const visual = handle === undefined ? undefined : this.entityVisuals.get(handle.slot);
    if (handle !== undefined && visual !== undefined && visual.generation === handle.generation) {
      visual.mesh.material = material;
    }
  };

  private readonly clearSelection = (): void => {
    this.setSelection(undefined);
    this.selectionListeners.clear();
  };
}
