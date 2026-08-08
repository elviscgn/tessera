// Arena camera: pure arithmetic for framing the table (M21).
//
// World coordinates are micrometres centred on the table origin; screen
// coordinates are pixels. The camera is a deterministic transform with no
// DOM or engine state, so projection, zoom, and pan are unit-testable.

export interface ArenaCameraView {
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface ArenaCameraSettings {
  /** Zoom: pixels per millimetre of world. */
  readonly pixelsPerMillimetre: number;
  /** Screen pixel of the table centre. */
  readonly centreX: number;
  readonly centreY: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

/** A camera that pins the table centre inside a viewport. */
export class ArenaCamera {
  private readonly settings: ArenaCameraSettings;

  public constructor(settings: ArenaCameraSettings) {
    this.settings = settings;
  }

  /** Fits the given table width (micrometres) with a 20% safety margin. */
  public static fitView(tableWidthMicros: number, view: ArenaCameraView): ArenaCamera {
    const millimetres = tableWidthMicros / 1_000;
    const pixelsPerMillimetre = view.widthPixels / (millimetres * 1.2);
    return new ArenaCamera({
      pixelsPerMillimetre,
      centreX: view.widthPixels / 2,
      centreY: view.heightPixels / 2,
    });
  }

  public get pixelsPerMillimetre(): number {
    return this.settings.pixelsPerMillimetre;
  }

  /** Projects a world point (micrometres, centred origin) into screen pixels. */
  public project(xMicros: number, zMicros: number): ProjectedPoint {
    return {
      x: this.settings.centreX + xMicros * (this.settings.pixelsPerMillimetre / 1_000),
      y: this.settings.centreY + zMicros * (this.settings.pixelsPerMillimetre / 1_000),
    };
  }

  /** Inverse of `project`: screen pixels back into world micrometres. */
  public unproject(x: number, y: number): [xMicros: number, zMicros: number] {
    const perMicro = this.settings.pixelsPerMillimetre / 1_000;
    return [(x - this.settings.centreX) / perMicro, (y - this.settings.centreY) / perMicro];
  }

  public withZoom(factor: number): ArenaCamera {
    return new ArenaCamera({
      ...this.settings,
      pixelsPerMillimetre: this.settings.pixelsPerMillimetre * factor,
    });
  }

  public withPan(deltaX: number, deltaY: number): ArenaCamera {
    return new ArenaCamera({
      ...this.settings,
      centreX: this.settings.centreX + deltaX,
      centreY: this.settings.centreY + deltaY,
    });
  }
}
