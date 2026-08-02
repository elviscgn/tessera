/** Returns a stable CSS-pixel viewport for a canvas element. */
export interface CanvasViewport {
  readonly width: number;
  readonly height: number;
}

export const viewportForCanvas = (canvas: HTMLCanvasElement): CanvasViewport => {
  const bounds = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width || canvas.clientWidth),
    height: Math.max(1, bounds.height || canvas.clientHeight),
  };
};
