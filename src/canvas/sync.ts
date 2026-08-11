import type { FlowLink, FlowNode, PortSide } from "../nodes/node-types";
import type { CanvasCamera } from "./store";

export type CanvasSyncSnapshot = {
  nodes: FlowNode[];
  links: FlowLink[];
  camera: CanvasCamera;
  version: number;
  updatedAt: string;
};

export type CanvasSyncOperation = {
  type: "node" | "link" | "camera";
  action: "upsert" | "delete";
  key: string;
  value?: unknown;
};

export function canvasLinkKey(link: FlowLink) {
  return `${link.from}:${link.to}:${link.fromSide || "right"}:${link.toSide || "left"}`;
}

export function normalizeCanvasLinks(
  values: Array<FlowLink | [number, number]>,
) {
  return values.map((value) => {
    const link = Array.isArray(value)
      ? {
          from: value[0],
          to: value[1],
          fromSide: "right" as PortSide,
          toSide: "left" as PortSide,
        }
      : value;
    return link.fromSide === "left" && link.toSide === "right"
      ? {
          ...link,
          from: link.to,
          to: link.from,
          fromSide: "right" as PortSide,
          toSide: "left" as PortSide,
        }
      : { ...link };
  });
}

function sameRecord(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNodeRecord(left: FlowNode | undefined, right: FlowNode) {
  if (!left) return false;
  if (
    left.jobId &&
    left.jobId === right.jobId &&
    ["queued", "running"].includes(String(left.status)) &&
    ["queued", "running"].includes(String(right.status))
  )
    return sameRecord(
      { ...left, progress: 0 },
      { ...right, progress: 0 },
    );
  return sameRecord(left, right);
}

export function diffCanvasSnapshots(
  base: CanvasSyncSnapshot,
  current: CanvasSyncSnapshot,
) {
  const operations: CanvasSyncOperation[] = [],
    baseNodes = new Map(base.nodes.map((node) => [String(node.id), node])),
    currentNodes = new Map(
      current.nodes.map((node) => [String(node.id), node]),
    );
  for (const [key, node] of currentNodes)
    if (!sameNodeRecord(baseNodes.get(key), node))
      operations.push({ type: "node", action: "upsert", key, value: node });
  for (const key of baseNodes.keys())
    if (!currentNodes.has(key))
      operations.push({ type: "node", action: "delete", key });
  const baseLinks = new Map(
      base.links.map((link) => [canvasLinkKey(link), link]),
    ),
    currentLinks = new Map(
      current.links.map((link) => [canvasLinkKey(link), link]),
    );
  for (const [key, link] of currentLinks)
    if (!baseLinks.has(key) || !sameRecord(baseLinks.get(key), link))
      operations.push({ type: "link", action: "upsert", key, value: link });
  for (const key of baseLinks.keys())
    if (!currentLinks.has(key))
      operations.push({ type: "link", action: "delete", key });
  if (!sameRecord(base.camera, current.camera))
    operations.push({
      type: "camera",
      action: "upsert",
      key: "camera",
      value: current.camera,
    });
  return operations;
}

export function applyCanvasOperations(
  snapshot: CanvasSyncSnapshot,
  operations: CanvasSyncOperation[],
): CanvasSyncSnapshot {
  const nodeMap = new Map(
      snapshot.nodes.map((node) => [String(node.id), structuredClone(node)]),
    ),
    linkMap = new Map(
      snapshot.links.map((link) => [
        canvasLinkKey(link),
        structuredClone(link),
      ]),
    );
  let nextCamera = { ...snapshot.camera };
  for (const operation of operations) {
    if (operation.type === "node") {
      if (operation.action === "delete") nodeMap.delete(operation.key);
      else
        nodeMap.set(
          operation.key,
          structuredClone(operation.value as FlowNode),
        );
    } else if (operation.type === "link") {
      if (operation.action === "delete") linkMap.delete(operation.key);
      else
        linkMap.set(
          operation.key,
          structuredClone(operation.value as FlowLink),
        );
    } else if (operation.action === "upsert")
      nextCamera = { ...(operation.value as CanvasCamera) };
  }
  return {
    ...snapshot,
    nodes: [...nodeMap.values()],
    links: [...linkMap.values()],
    camera: nextCamera,
  };
}
