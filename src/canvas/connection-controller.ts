import type { Point, PortSide } from "../nodes/node-types";

export type PendingConnection = {
  nodeId: number;
  side: PortSide;
  origin: Point;
  pointer: Point;
};

export type ConnectionSnap = { nodeId: number; side: PortSide };

/** Owns transient connection interaction state; rendering remains stateless. */
export class CanvasConnectionController {
  active: PendingConnection | null = null;
  snap: ConnectionSnap | null = null;
  hoveredLinkIndex = -1;
  touchSelectedLinkIndex = -1;
  readonly snapRadius: number;

  constructor(snapRadius = 48) {
    this.snapRadius = snapRadius;
  }

  begin(nodeId: number, side: PortSide, pointer: Point) {
    this.active = { nodeId, side, origin: { ...pointer }, pointer };
    this.snap = null;
  }

  update(pointer: Point, snap: ConnectionSnap | null) {
    if (!this.active) return;
    this.active.pointer = pointer;
    this.snap = snap;
  }

  cancel() {
    this.active = null;
    this.snap = null;
  }

  clearLinkSelection() {
    this.hoveredLinkIndex = -1;
    this.touchSelectedLinkIndex = -1;
  }
}
