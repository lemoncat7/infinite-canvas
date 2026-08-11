import type { FlowNode, Point, PortSide } from "../nodes/node-types";

export type CameraState = { x: number; y: number; zoom: number };
export type ViewportSize = { width: number; height: number };

export function worldToScreen(
  point: Point,
  camera: CameraState,
  viewport: ViewportSize,
): Point {
  return {
    x: viewport.width / 2 + camera.x + point.x * camera.zoom,
    y: viewport.height / 2 + camera.y + point.y * camera.zoom,
  };
}

export function screenToWorld(
  point: Point,
  camera: CameraState,
  viewport: ViewportSize,
): Point {
  return {
    x: (point.x - viewport.width / 2 - camera.x) / camera.zoom,
    y: (point.y - viewport.height / 2 - camera.y) / camera.zoom,
  };
}

export function nodePortPosition(node: FlowNode, side: PortSide): Point {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "right")
    return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === "bottom")
    return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
}

export function connectionControlPoint(
  point: Point,
  side: PortSide,
  distance: number,
): Point {
  if (side === "top") return { x: point.x, y: point.y - distance };
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x - distance, y: point.y };
}
