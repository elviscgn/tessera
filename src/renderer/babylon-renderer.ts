import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import './register-loaders.js';
import type { RenderSnapshotMetadata } from '../worker/data-protocol';

/** Renderer-only counters exposed by the foundation runtime. */
export interface RendererDiagnostics {
  readonly renderFrames: number;
  readonly receivedSnapshots: number;
  readonly lastSnapshotGeneration: bigint;
  readonly lastSimulationTick: bigint;
  readonly lastEntityCount: number;
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
  private disposed = false;
  private started = false;
  private renderFrames = 0;
  private receivedSnapshots = 0;
  private lastSnapshotGeneration = 0n;
  private lastSimulationTick = 0n;
  private lastEntityCount = 0;

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
    }
  };

  public constructor(canvas: HTMLCanvasElement) {
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

    this.camera = new FreeCamera('tessera-foundation-camera', new Vector3(0, 3, -6), this.scene);
    this.camera.setTarget(Vector3.Zero());
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

    this.scene.onBeforeRenderObservable.add(this.beforeRender);
    window.addEventListener('resize', this.resize);
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
  public consumeSnapshot(snapshot: RenderSnapshotMetadata): void {
    if (this.disposed) {
      throw new Error('tessera:renderer:disposed:cannot consume a snapshot after disposal');
    }
    this.receivedSnapshots += 1;
    this.lastSnapshotGeneration = snapshot.snapshotGeneration;
    this.lastSimulationTick = snapshot.simulationTick;
    this.lastEntityCount = snapshot.entityCount;
  }

  public diagnostics(): RendererDiagnostics {
    return {
      renderFrames: this.renderFrames,
      receivedSnapshots: this.receivedSnapshots,
      lastSnapshotGeneration: this.lastSnapshotGeneration,
      lastSimulationTick: this.lastSimulationTick,
      lastEntityCount: this.lastEntityCount,
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
    this.placeholder.dispose(false, true);
    this.placeholderMaterial.dispose();
    this.light.dispose();
    this.camera.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
