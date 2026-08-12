import type { FlowNode } from "../nodes/node-types";

export type NodeSnapResult = { dx: number; dy: number };

const SNAP_GAP = 24;
const SNAP_SCREEN_THRESHOLD = 12;

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.min(a1, b1) >= Math.max(a0, b0);
}

/** Pure interaction geometry: it never mutates nodes or requests a render. */
export function snapNodeGroup(options: {
  moving: readonly FlowNode[];
  candidates: readonly FlowNode[];
  dx: number;
  dy: number;
  zoom: number;
}): NodeSnapResult {
  const { moving, candidates, dx, dy } = options;
  if (!moving.length || !candidates.length) return { dx, dy };
  const threshold = SNAP_SCREEN_THRESHOLD / Math.max(0.1, options.zoom);
  const left = Math.min(...moving.map((node) => node.x)) + dx;
  const top = Math.min(...moving.map((node) => node.y)) + dy;
  const right = Math.max(...moving.map((node) => node.x + node.width)) + dx;
  const bottom = Math.max(...moving.map((node) => node.y + node.height)) + dy;

  let xCorrection = 0;
  let yCorrection = 0;
  let xDistance = threshold + 1;
  let yDistance = threshold + 1;
  for (const target of candidates) {
    const targetRight = target.x + target.width;
    const targetBottom = target.y + target.height;
    if (overlap(top, bottom, target.y, targetBottom)) {
      for (const correction of [
        target.x - SNAP_GAP - right,
        targetRight + SNAP_GAP - left,
      ]) {
        const distance = Math.abs(correction);
        if (distance <= threshold && distance < xDistance) {
          xDistance = distance;
          xCorrection = correction;
        }
      }
    }
    if (overlap(left, right, target.x, targetRight)) {
      for (const correction of [
        target.y - SNAP_GAP - bottom,
        targetBottom + SNAP_GAP - top,
      ]) {
        const distance = Math.abs(correction);
        if (distance <= threshold && distance < yDistance) {
          yDistance = distance;
          yCorrection = correction;
        }
      }
    }
  }
  return { dx: dx + xCorrection, dy: dy + yCorrection };
}

export const NODE_SNAP_GAP = SNAP_GAP;
