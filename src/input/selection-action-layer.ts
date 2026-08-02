import type { ScreenPoint } from '../renderer/entity-selection';

export interface SelectionActionLayerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onPrimaryClick: (point: ScreenPoint) => void;
}

/** Turns a click gesture into a canvas-relative selection action. */
export class SelectionActionLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onPrimaryClick: (point: ScreenPoint) => void;
  private attached = false;
  private readonly click = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const bounds = this.canvas.getBoundingClientRect();
    this.onPrimaryClick({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  public constructor(options: SelectionActionLayerOptions) {
    this.canvas = options.canvas;
    this.onPrimaryClick = options.onPrimaryClick;
  }

  public attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.canvas.addEventListener('click', this.click);
  }

  public dispose(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.canvas.removeEventListener('click', this.click);
  }
}
