import { CameraProjection, type CameraViewport } from '../renderer/isometric-camera';

type CameraAction =
  | { readonly type: 'pan'; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: 'zoom'; readonly factor: number }
  | { readonly type: 'rotate'; readonly direction: 'clockwise' | 'counter-clockwise' };

export interface CameraActionLayerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraProjection;
  readonly viewport: () => CameraViewport;
}

/**
 * Translates DOM gestures into named presentation actions.
 *
 * This layer never creates simulation commands. It owns only camera focus,
 * pointer capture, and the camera projection supplied by the runtime.
 */
export class CameraActionLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: CameraProjection;
  private readonly viewport: () => CameraViewport;
  private attached = false;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    event.preventDefault();
    this.dispatch({ type: 'pan', deltaX, deltaY });
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.dispatch({ type: 'zoom', factor: Math.exp(event.deltaY * 0.001) });
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === 'q') {
      event.preventDefault();
      this.dispatch({ type: 'rotate', direction: 'counter-clockwise' });
    } else if (event.key.toLowerCase() === 'e') {
      event.preventDefault();
      this.dispatch({ type: 'rotate', direction: 'clockwise' });
    }
  };

  private readonly blur = (): void => {
    this.dragging = false;
  };

  public constructor(options: CameraActionLayerOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.viewport = options.viewport;
  }

  public attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    this.canvas.addEventListener('pointermove', this.pointerMove);
    this.canvas.addEventListener('pointerup', this.pointerUp);
    this.canvas.addEventListener('pointercancel', this.pointerUp);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.canvas.addEventListener('keydown', this.keyDown);
    this.canvas.addEventListener('blur', this.blur);
  }

  public dispose(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.dragging = false;
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointermove', this.pointerMove);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.pointerUp);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('keydown', this.keyDown);
    this.canvas.removeEventListener('blur', this.blur);
  }

  private dispatch(action: CameraAction): void {
    switch (action.type) {
      case 'pan':
        this.camera.panByPixels(action.deltaX, action.deltaY, this.viewport());
        break;
      case 'zoom':
        this.camera.zoomBy(action.factor);
        break;
      case 'rotate':
        this.rotate(action.direction);
        break;
    }
  }

  private rotate(direction: 'clockwise' | 'counter-clockwise'): void {
    if (direction === 'clockwise') {
      this.camera.rotateClockwise();
      return;
    }
    this.camera.rotateCounterClockwise();
  }
}
