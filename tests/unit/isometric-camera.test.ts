import { describe, expect, it } from 'vitest';
import {
  CameraProjection,
  MAX_CAMERA_ZOOM_TILES,
  MIN_CAMERA_ZOOM_TILES,
  type CameraRotation,
} from '../../src/renderer/isometric-camera';

const viewport = { width: 1200, height: 800 };

const expectClose = (actual: number, expected: number, precision = 8): void => {
  expect(actual).toBeCloseTo(expected, precision);
};

describe('isometric camera projection', () => {
  it('uses integer tile boundaries and mathematical floor division', () => {
    const camera = new CameraProjection({ tileSizeMm: 750 });

    expect(camera.worldToGrid({ xMm: 0, zMm: 0 })).toEqual({ x: 0, z: 0 });
    expect(camera.worldToGrid({ xMm: -1, zMm: -750 })).toEqual({ x: -1, z: -1 });
    expect(camera.worldToGrid({ xMm: -751, zMm: 749 })).toEqual({ x: -2, z: 0 });
    expect(camera.gridToWorldCenter({ x: -2, z: 3 }, 125)).toEqual({
      xMm: -1125,
      yMm: 125,
      zMm: 2625,
    });
  });

  it.each([0, 1, 2, 3] as CameraRotation[])(
    'round-trips world points at rotation r%s',
    (rotation) => {
      const camera = new CameraProjection({
        rotation,
        targetMm: { xMm: 2500, yMm: 300, zMm: -1500 },
        zoomTiles: 10,
      });
      const points = [
        { xMm: 2500, yMm: 0, zMm: -1500 },
        { xMm: 7250, yMm: 900, zMm: 3250 },
        { xMm: -1750, yMm: -400, zMm: -6250 },
      ];

      for (const point of points) {
        const screen = camera.worldToScreen(point, viewport);
        const world = camera.screenToWorld(screen, viewport, point.yMm);
        expect(world).toBeDefined();
        if (!world) {
          continue;
        }
        expectClose(world.xMm, point.xMm);
        expectClose(world.yMm, point.yMm);
        expectClose(world.zMm, point.zMm);
        expect(screen.depthMm).toBeGreaterThan(0);
      }
    },
  );

  it('picks the expected grid cell at every camera rotation', () => {
    for (const rotation of [0, 1, 2, 3] as CameraRotation[]) {
      const camera = new CameraProjection({ rotation, tileSizeMm: 1000, zoomTiles: 8 });
      const center = camera.gridToWorldCenter({ x: -2, z: 3 }, 0);
      const screen = camera.worldToScreen(center, viewport);
      expect(camera.screenToGrid(screen, viewport, 0)).toEqual({ x: -2, z: 3 });
    }
  });

  it('pans the world with the pointer and clamps zoom', () => {
    const camera = new CameraProjection({ zoomTiles: 8 });
    const target = camera.state.targetMm;
    const before = camera.worldToScreen(target, viewport);

    camera.panByPixels(50, -20, viewport);
    const after = camera.worldToScreen(target, viewport);
    expectClose(after.x, before.x + 50);
    expectClose(after.y, before.y - 20);

    camera.zoomBy(0.001);
    expect(camera.state.zoomTiles).toBe(MIN_CAMERA_ZOOM_TILES);
    camera.zoomBy(10_000);
    expect(camera.state.zoomTiles).toBe(MAX_CAMERA_ZOOM_TILES);
  });

  it('cycles four rotations and notifies presentation subscribers', () => {
    const camera = new CameraProjection();
    const rotations: number[] = [];
    const unsubscribe = camera.subscribe((state) => rotations.push(state.rotation));

    camera.rotateClockwise();
    camera.rotateClockwise();
    camera.rotateCounterClockwise();
    unsubscribe();
    camera.rotateClockwise();

    expect(rotations).toEqual([0, 1, 2, 1]);
    expect(camera.state.rotation).toBe(2);

    camera.focusGrid({ x: -3, z: 4 }, 500);
    expect(camera.state.targetMm).toEqual({ xMm: -2500, yMm: 500, zMm: 4500 });
  });

  it('rejects invalid viewport, tile, and zoom input', () => {
    expect(() => new CameraProjection({ tileSizeMm: 0 })).toThrow('invalid_tile_size');
    const camera = new CameraProjection();
    expect(() => camera.worldToScreen({ xMm: 0, yMm: 0, zMm: 0 }, { width: 0, height: 1 })).toThrow(
      'invalid_viewport',
    );
    expect(() => camera.zoomBy(0)).toThrow('invalid_zoom_factor');
  });
});
