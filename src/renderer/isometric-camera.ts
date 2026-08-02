/**
 * Deterministic presentation-space camera and coordinate conversion.
 *
 * The simulation never consumes this module. It exists to keep the browser's
 * camera math in one place and to make the coordinate laboratory testable
 * without a WebGL context.
 */

export type CameraRotation = 0 | 1 | 2 | 3;

export interface CameraPointMm {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

export interface GridCoordinate {
  readonly x: number;
  readonly z: number;
}

export interface CameraViewport {
  readonly width: number;
  readonly height: number;
}

export interface CameraState {
  readonly targetMm: CameraPointMm;
  /** Four clockwise quarter-turns, matching the authoritative rotation enum. */
  readonly rotation: CameraRotation;
  /** The vertical orthographic view size, measured in tiles. */
  readonly zoomTiles: number;
}

export interface CameraProjectionOptions {
  readonly tileSizeMm?: number;
  readonly targetMm?: CameraPointMm;
  readonly rotation?: CameraRotation;
  readonly zoomTiles?: number;
  /** Defaults to the mathematically symmetric isometric pitch. */
  readonly pitchRadians?: number;
}

export interface CameraVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly positionMm: CameraPointMm;
  readonly targetMm: CameraPointMm;
  readonly forward: CameraVector;
  readonly right: CameraVector;
  readonly up: CameraVector;
  readonly distanceMm: number;
}

export interface CameraScreenPoint {
  readonly x: number;
  readonly y: number;
  /** Positive values are in front of the orthographic camera. */
  readonly depthMm: number;
}

export interface OrthographicBoundsMm {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const DEFAULT_TILE_SIZE_MM = 1000;
export const DEFAULT_CAMERA_ZOOM_TILES = 12;
export const MIN_CAMERA_ZOOM_TILES = 2;
export const MAX_CAMERA_ZOOM_TILES = 512;
export const DEFAULT_CAMERA_PITCH_RADIANS = Math.atan(Math.SQRT1_2);

const BASE_CAMERA_AZIMUTH_RADIANS = (3 * Math.PI) / 4;
const QUARTER_TURN_RADIANS = Math.PI / 2;
const MIN_PITCH_RADIANS = 0.01;
const MAX_PITCH_RADIANS = Math.PI / 2 - 0.01;
const INTERSECTION_EPSILON = 1e-9;

type CameraListener = (state: CameraState) => void;

const clonePoint = (point: CameraPointMm): CameraPointMm => ({
  xMm: point.xMm,
  yMm: point.yMm,
  zMm: point.zMm,
});

const cloneState = (state: CameraState): CameraState => ({
  targetMm: clonePoint(state.targetMm),
  rotation: state.rotation,
  zoomTiles: state.zoomTiles,
});

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const assertFinitePoint = (point: CameraPointMm, label: string): void => {
  if (!isFiniteNumber(point.xMm) || !isFiniteNumber(point.yMm) || !isFiniteNumber(point.zMm)) {
    throw new Error(`tessera:camera:invalid_${label}:coordinates must be finite`);
  }
};

const assertViewport = (viewport: CameraViewport): void => {
  if (
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error('tessera:camera:invalid_viewport:width and height must be positive');
  }
};

const assertCell = (cell: GridCoordinate): void => {
  if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.z)) {
    throw new Error('tessera:camera:invalid_cell:coordinates must be safe integers');
  }
};

const normalizeRotation = (rotation: number): CameraRotation => {
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
    throw new Error('tessera:camera:invalid_rotation:rotation must be one of 0, 1, 2, or 3');
  }
  return rotation as CameraRotation;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeTileSize = (tileSizeMm: number): number => {
  if (!Number.isSafeInteger(tileSizeMm) || tileSizeMm <= 0) {
    throw new Error('tessera:camera:invalid_tile_size:tile size must be a positive integer');
  }
  return tileSizeMm;
};

const normalizePitch = (pitchRadians: number): number => {
  if (
    !isFiniteNumber(pitchRadians) ||
    pitchRadians <= MIN_PITCH_RADIANS ||
    pitchRadians >= MAX_PITCH_RADIANS
  ) {
    throw new Error('tessera:camera:invalid_pitch:pitch must be between horizontal and vertical');
  }
  return pitchRadians;
};

const normalizeZoom = (zoomTiles: number): number => {
  if (!isFiniteNumber(zoomTiles) || zoomTiles <= 0) {
    throw new Error('tessera:camera:invalid_zoom:zoom must be positive');
  }
  return clamp(zoomTiles, MIN_CAMERA_ZOOM_TILES, MAX_CAMERA_ZOOM_TILES);
};

const dot = (left: CameraVector, right: CameraVector): number =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const add = (left: CameraPointMm, right: CameraVector): CameraPointMm => ({
  xMm: left.xMm + right.x,
  yMm: left.yMm + right.y,
  zMm: left.zMm + right.z,
});

const subtract = (left: CameraPointMm, right: CameraPointMm): CameraVector => ({
  x: left.xMm - right.xMm,
  y: left.yMm - right.yMm,
  z: left.zMm - right.zMm,
});

const scale = (vector: CameraVector, factor: number): CameraVector => ({
  x: vector.x * factor,
  y: vector.y * factor,
  z: vector.z * factor,
});

const addVectors = (left: CameraVector, right: CameraVector): CameraVector => ({
  x: left.x + right.x,
  y: left.y + right.y,
  z: left.z + right.z,
});

/**
 * Camera math for the right-handed glTF-aligned world.
 *
 * `+X` is east, `+Y` is up, and `+Z` is south. Rotation zero looks from the
 * north-east toward the target. Increasing the rotation moves the camera
 * clockwise in the top-down world view. The projection uses millimetres so
 * integer grid boundaries remain explicit even when a tile is not one metre.
 */
export class CameraProjection {
  public readonly tileSizeMm: number;
  public readonly pitchRadians: number;

  private currentState: CameraState;
  private readonly listeners = new Set<CameraListener>();

  public constructor(options: CameraProjectionOptions = {}) {
    const tileSizeMm = normalizeTileSize(options.tileSizeMm ?? DEFAULT_TILE_SIZE_MM);
    const pitchRadians = normalizePitch(options.pitchRadians ?? DEFAULT_CAMERA_PITCH_RADIANS);
    const targetMm = options.targetMm ?? { xMm: 0, yMm: 0, zMm: 0 };
    assertFinitePoint(targetMm, 'target');
    const rotation = normalizeRotation(options.rotation ?? 0);
    const zoomTiles = normalizeZoom(options.zoomTiles ?? DEFAULT_CAMERA_ZOOM_TILES);

    this.tileSizeMm = tileSizeMm;
    this.pitchRadians = pitchRadians;
    this.currentState = {
      targetMm: clonePoint(targetMm),
      rotation,
      zoomTiles,
    };
  }

  public get state(): CameraState {
    return cloneState(this.currentState);
  }

  public subscribe(listener: CameraListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setState(state: CameraState): void {
    assertFinitePoint(state.targetMm, 'target');
    const rotation = normalizeRotation(state.rotation);
    if (!isFiniteNumber(state.zoomTiles) || state.zoomTiles <= 0) {
      throw new Error('tessera:camera:invalid_zoom:zoom must be positive');
    }
    this.currentState = {
      targetMm: clonePoint(state.targetMm),
      rotation,
      zoomTiles: normalizeZoom(state.zoomTiles),
    };
    this.notify();
  }

  public focusWorld(targetMm: CameraPointMm): void {
    assertFinitePoint(targetMm, 'target');
    this.currentState = { ...this.currentState, targetMm: clonePoint(targetMm) };
    this.notify();
  }

  public focusGrid(cell: GridCoordinate, elevationMm: number): void {
    if (!Number.isFinite(elevationMm)) {
      throw new Error('tessera:camera:invalid_elevation:elevation must be finite');
    }
    this.focusWorld(this.gridToWorldCenter(cell, elevationMm));
  }

  /** Moves the camera target so the world follows a pointer drag. */
  public panByPixels(deltaX: number, deltaY: number, viewport: CameraViewport): void {
    if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) {
      throw new Error('tessera:camera:invalid_pan:pan deltas must be finite');
    }
    const pixelsPerMm = this.pixelsPerMillimetre(viewport);
    const pose = this.pose();
    const targetDelta = addVectors(
      scale(pose.right, -deltaX / pixelsPerMm),
      scale(pose.up, deltaY / pixelsPerMm),
    );
    this.focusWorld({
      xMm: this.currentState.targetMm.xMm + targetDelta.x,
      yMm: this.currentState.targetMm.yMm + targetDelta.y,
      zMm: this.currentState.targetMm.zMm + targetDelta.z,
    });
  }

  /** Multiplies the visible tile height; values above one zoom out. */
  public zoomBy(factor: number): void {
    if (!isFiniteNumber(factor) || factor <= 0) {
      throw new Error('tessera:camera:invalid_zoom_factor:zoom factor must be positive');
    }
    this.setState({ ...this.currentState, zoomTiles: this.currentState.zoomTiles * factor });
  }

  public rotateClockwise(): void {
    this.setState({
      ...this.currentState,
      rotation: ((this.currentState.rotation + 1) % 4) as CameraRotation,
    });
  }

  public rotateCounterClockwise(): void {
    this.setState({
      ...this.currentState,
      rotation: ((this.currentState.rotation + 3) % 4) as CameraRotation,
    });
  }

  public gridToWorldCenter(cell: GridCoordinate, elevationMm: number): CameraPointMm {
    assertCell(cell);
    if (!Number.isFinite(elevationMm)) {
      throw new Error('tessera:camera:invalid_elevation:elevation must be finite');
    }
    return {
      xMm: (cell.x + 0.5) * this.tileSizeMm,
      yMm: elevationMm,
      zMm: (cell.z + 0.5) * this.tileSizeMm,
    };
  }

  /** Uses mathematical floor division, including for negative boundaries. */
  public worldToGrid(pointMm: Pick<CameraPointMm, 'xMm' | 'zMm'>): GridCoordinate {
    if (!Number.isFinite(pointMm.xMm) || !Number.isFinite(pointMm.zMm)) {
      throw new Error('tessera:camera:invalid_world:coordinates must be finite');
    }
    return {
      x: Math.floor(pointMm.xMm / this.tileSizeMm),
      z: Math.floor(pointMm.zMm / this.tileSizeMm),
    };
  }

  public worldToScreen(pointMm: CameraPointMm, viewport: CameraViewport): CameraScreenPoint {
    assertFinitePoint(pointMm, 'world');
    assertViewport(viewport);
    const pose = this.pose();
    const relative = subtract(pointMm, this.currentState.targetMm);
    const pixelsPerMm = this.pixelsPerMillimetre(viewport);
    return {
      x: viewport.width / 2 + dot(relative, pose.right) * pixelsPerMm,
      y: viewport.height / 2 - dot(relative, pose.up) * pixelsPerMm,
      depthMm: dot(relative, pose.forward) + pose.distanceMm,
    };
  }

  /**
   * Intersects an orthographic camera ray with a horizontal elevation plane.
   * Parallel rays and planes behind the camera return `undefined`.
   */
  public screenToWorld(
    screen: Pick<CameraScreenPoint, 'x' | 'y'>,
    viewport: CameraViewport,
    elevationMm: number,
  ): CameraPointMm | undefined {
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
      throw new Error('tessera:camera:invalid_screen:coordinates must be finite');
    }
    if (!Number.isFinite(elevationMm)) {
      throw new Error('tessera:camera:invalid_elevation:elevation must be finite');
    }
    assertViewport(viewport);
    const pose = this.pose();
    if (Math.abs(pose.forward.y) <= INTERSECTION_EPSILON) {
      return undefined;
    }
    const pixelsPerMm = this.pixelsPerMillimetre(viewport);
    const screenOffsetX = (screen.x - viewport.width / 2) / pixelsPerMm;
    const screenOffsetY = -(screen.y - viewport.height / 2) / pixelsPerMm;
    const cameraPosition = add(this.currentState.targetMm, scale(pose.forward, -pose.distanceMm));
    const origin = add(
      add(cameraPosition, scale(pose.right, screenOffsetX)),
      scale(pose.up, screenOffsetY),
    );
    const distance = (elevationMm - origin.yMm) / pose.forward.y;
    if (distance < -INTERSECTION_EPSILON) {
      return undefined;
    }
    const point = add(origin, scale(pose.forward, distance));
    return { xMm: point.xMm, yMm: point.yMm, zMm: point.zMm };
  }

  public screenToGrid(
    screen: Pick<CameraScreenPoint, 'x' | 'y'>,
    viewport: CameraViewport,
    elevationMm: number,
  ): GridCoordinate | undefined {
    const point = this.screenToWorld(screen, viewport, elevationMm);
    return point === undefined ? undefined : this.worldToGrid(point);
  }

  public pose(): CameraPose {
    const azimuth = BASE_CAMERA_AZIMUTH_RADIANS - this.currentState.rotation * QUARTER_TURN_RADIANS;
    const horizontal = Math.cos(this.pitchRadians);
    const sinAzimuth = Math.sin(azimuth);
    const cosAzimuth = Math.cos(azimuth);
    const sinPitch = Math.sin(this.pitchRadians);
    const cosPitch = horizontal;
    const forward: CameraVector = {
      x: -sinAzimuth * cosPitch,
      y: -sinPitch,
      z: -cosAzimuth * cosPitch,
    };
    const right: CameraVector = {
      x: cosAzimuth,
      y: 0,
      z: -sinAzimuth,
    };
    const up: CameraVector = {
      x: -sinAzimuth * sinPitch,
      y: cosPitch,
      z: -cosAzimuth * sinPitch,
    };
    const viewHeightMm = this.currentState.zoomTiles * this.tileSizeMm;
    const distanceMm = Math.max(viewHeightMm * 2, this.tileSizeMm * 8);
    const positionMm = add(this.currentState.targetMm, scale(forward, -distanceMm));
    return {
      positionMm,
      targetMm: clonePoint(this.currentState.targetMm),
      forward,
      right,
      up,
      distanceMm,
    };
  }

  public orthographicBounds(viewport: CameraViewport): OrthographicBoundsMm {
    assertViewport(viewport);
    const height = this.currentState.zoomTiles * this.tileSizeMm;
    const width = height * (viewport.width / viewport.height);
    return {
      left: -width / 2,
      right: width / 2,
      top: height / 2,
      bottom: -height / 2,
    };
  }

  private pixelsPerMillimetre(viewport: CameraViewport): number {
    assertViewport(viewport);
    return viewport.height / (this.currentState.zoomTiles * this.tileSizeMm);
  }

  private notify(): void {
    const state = this.state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
