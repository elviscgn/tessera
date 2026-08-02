import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import './register-loaders.js';
import type { RenderGridCell, RenderSnapshotMetadata } from '../worker/data-protocol';
import { CameraProjection, type CameraViewport } from './isometric-camera';

/** Renderer-only counters exposed by the foundation runtime. */
export interface RendererDiagnostics {
  readonly renderFrames: number;
  readonly receivedSnapshots: number;
  readonly lastSnapshotGeneration: bigint;
  readonly lastSimulationTick: bigint;
  readonly lastEntityCount: number;
  readonly occupiedCellCount?: number;
  readonly disposed: boolean;
}

/**
 * Babylon ownership for the foundation milestone.
 *
 * This class intentionally owns no authoritative entity state. It creates one
 * placeholder visual and records snapshot metadata until the later renderer
 * synchronization milestone introduces slot/generation visual mappings.
 */
export class BabylonRenderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly light: HemisphericLight;
  private readonly placeholder: ReturnType<typeof MeshBuilder.CreateBox>;
  private readonly placeholderMaterial: StandardMaterial;
  private readonly debugGridMaterial: StandardMaterial;
  private readonly occupiedMaterial: StandardMaterial;
  private readonly cameraProjection: CameraProjection;
  private readonly unsubscribeCamera: () => void;
  private debugGrid: LinesMesh | undefined;
  private debugGridKey = '';
  private occupiedVisuals: Array<ReturnType<typeof MeshBuilder.CreateBox>> = [];
  private disposed = false;
  private started = false;
  private renderFrames = 0;
  private receivedSnapshots = 0;
  private lastSnapshotGeneration = 0n;
  private lastSimulationTick = 0n;
  private lastEntityCount = 0;
  private lastOccupiedCellCount = 0;

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
  ): void {
    if (this.disposed) {
      throw new Error('tessera:renderer:disposed:cannot consume a snapshot after disposal');
    }
    this.receivedSnapshots += 1;
    this.lastSnapshotGeneration = snapshot.snapshotGeneration;
    this.lastSimulationTick = snapshot.simulationTick;
    this.lastEntityCount = snapshot.entityCount;
    this.updateOccupiedOverlay(occupiedCells);
  }

  public diagnostics(): RendererDiagnostics {
    return {
      renderFrames: this.renderFrames,
      receivedSnapshots: this.receivedSnapshots,
      lastSnapshotGeneration: this.lastSnapshotGeneration,
      lastSimulationTick: this.lastSimulationTick,
      lastEntityCount: this.lastEntityCount,
      occupiedCellCount: this.lastOccupiedCellCount,
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
    this.placeholder.dispose(false, true);
    this.placeholderMaterial.dispose();
    this.debugGridMaterial.dispose();
    this.occupiedMaterial.dispose();
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
}
