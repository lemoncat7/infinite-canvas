import type { FlowNode, Point } from "../nodes/node-types";
import { snapNodeGroup } from "./node-snap-controller";

/**
 * Shared drag geometry for DOM and canvas pointer lifecycles. The caller owns
 * rendering; this module is the single authority for final node positions.
 */
export function positionDraggedNodes(options: {
  nodes: FlowNode[];
  origins: ReadonlyMap<number, Point>;
  dx: number;
  dy: number;
  zoom: number;
}) {
  const moving = options.nodes.filter((node) => options.origins.has(node.id));
  if (!moving.length) return;
  let dx = options.dx;
  let dy = options.dy;
  if (moving.length === 1) {
    const node = moving[0];
    const origin = options.origins.get(node.id)!;
    const geometry = { ...node, x: origin.x, y: origin.y };
    const snapped = snapNodeGroup({
      moving: [geometry],
      candidates: options.nodes.filter((candidate) => candidate.id !== node.id),
      dx,
      dy,
      zoom: options.zoom,
    });
    dx = snapped.dx;
    dy = snapped.dy;
  }
  for (const node of moving) {
    const origin = options.origins.get(node.id)!;
    node.x = origin.x + dx;
    node.y = origin.y + dy;
  }
}
