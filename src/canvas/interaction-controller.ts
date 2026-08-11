import type { Point } from "../nodes/node-types";

export type CanvasPointerState = {
  down: boolean;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  blankCanvas: boolean;
  draggingNode: number | null;
  draggingGroup: Set<number> | null;
  toggleBatchOnRelease: number;
};

export type MarqueeState = {
  pointerId: number;
  start: Point;
  worldStart: Point;
  current: Point;
  active: boolean;
  baseSelection: Set<number>;
};

/** Owns pointer and marquee gesture state independently from DOM handlers. */
export class CanvasInteractionController {
  readonly pointer: CanvasPointerState = {
    down: false,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    moved: false,
    blankCanvas: false,
    draggingNode: null,
    draggingGroup: null,
    toggleBatchOnRelease: 0,
  };

  marquee: MarqueeState | null = null;
  marqueeMode = false;
  quickMarqueeMode = false;

  beginPointer(point: Point) {
    Object.assign(this.pointer, {
      down: true,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      moved: false,
      blankCanvas: true,
      draggingNode: null,
      draggingGroup: null,
      toggleBatchOnRelease: 0,
    });
  }

  resetPointer() {
    Object.assign(this.pointer, {
      down: false,
      draggingNode: null,
      draggingGroup: null,
      toggleBatchOnRelease: 0,
      blankCanvas: false,
    });
  }

  beginMarquee(state: MarqueeState, quick = false) {
    this.marquee = state;
    this.marqueeMode = true;
    this.quickMarqueeMode = quick;
  }

  clearMarquee() {
    this.marquee = null;
    this.quickMarqueeMode = false;
  }
}
