import type { FlowLink, FlowNode } from "./node-types";
import {
  nodeDomState,
  nodeDomStateEquals,
  normalizeNodeViewSize,
  styleNodeEditor,
} from "./node-dom-state";

export type NodeDomSyncFlags = {
  selected: boolean; batchSelected: boolean; agentReference: boolean;
  locked: boolean; workflowWaiting: boolean; onscreen: boolean; editing: boolean;
  colorTheme: string; videoDependency: string; swapSourceId: number;
};

export type NodeDomStateRecord = {
  element: HTMLElement;
  value: unknown[];
};

type Options = {
  viewport: HTMLElement; layer: HTMLElement; nodes: FlowNode[]; links: FlowLink[];
  camera: { x: number; y: number; zoom: number }; selectedId: number;
  selectedDomVisible: boolean;
  batchIds: Set<number>; editingId: number; draggingId: number;
  agentSelecting: boolean; agentIds: Set<number>; colorTheme: string;
  swap: { videoId: number; sourceId: number } | null;
  mountedIds: Set<number>; detached: Map<number, HTMLElement>; states: Map<number, NodeDomStateRecord>;
  cacheDetached: (id: number, element: HTMLElement) => void;
  createElement: (node: FlowNode) => HTMLElement;
  isGenerating: (node: FlowNode) => boolean;
  syncNode: (element: HTMLElement, node: FlowNode, flags: NodeDomSyncFlags) => void;
};

export function synchronizeNodeDom(options: Options) {
  const { nodes, camera } = options;
  options.viewport.style.transform = `translate3d(${innerWidth / 2 + camera.x}px, ${innerHeight / 2 + camera.y}px,0) scale(${camera.zoom})`;
  const offsetX = innerWidth / 2 + camera.x,
    offsetY = innerHeight / 2 + camera.y,
    margin = 480,
    required = new Set(nodes
      .filter((node) => {
        const screenX = offsetX + node.x * camera.zoom;
        const screenY = offsetY + node.y * camera.zoom;
        return screenX + node.width * camera.zoom > -margin &&
          screenX < innerWidth + margin &&
          screenY + node.height * camera.zoom > -margin &&
          screenY < innerHeight + margin;
      })
      .map((node) => node.id));
  if (options.selectedDomVisible && options.selectedId)
    required.add(options.selectedId);
  if (options.editingId) required.add(options.editingId);
  if (options.draggingId) required.add(options.draggingId);
  const allIds = new Set(nodes.map((node) => node.id));
  options.mountedIds.clear();
  required.forEach((id) => options.mountedIds.add(id));
  for (const id of options.detached.keys()) if (!allIds.has(id)) {
    options.detached.delete(id); options.states.delete(id);
  }
  options.layer.querySelectorAll<HTMLElement>(".flow-node").forEach((element) => {
    const id = Number(element.dataset.id);
    if (required.has(id)) return;
    if (allIds.has(id)) options.cacheDetached(id, element);
    else { options.states.delete(id); options.detached.delete(id); element.remove(); }
  });
  const imageStates = new Map(nodes.filter((node) => node.kind === "image").map((node) => [node.id, `${node.status ?? ""}:${node.mediaUrl ?? ""}`]));
  const dependencies = new Map<number, string[]>();
  for (const link of options.links) {
    const imageState = imageStates.get(link.from);
    if (imageState === undefined) continue;
    const part = `${link.from}:${link.inputOrder ?? ""}:${imageState}`, existing = dependencies.get(link.to);
    if (existing) existing.push(part); else dependencies.set(link.to, [part]);
  }
  for (const node of nodes) {
    normalizeNodeViewSize(node);
    if (!required.has(node.id)) continue;
    let element = options.layer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);
    if (!element) {
      element = options.detached.get(node.id) ?? null;
      if (element) { options.detached.delete(node.id); options.layer.append(element); }
    }
    if (!element) { element = options.createElement(node); options.layer.append(element); options.states.delete(node.id); }
    element.dataset.renderOwner = "dom";
    const screenX = innerWidth / 2 + camera.x + node.x * camera.zoom,
      screenY = innerHeight / 2 + camera.y + node.y * camera.zoom;
    const workflowWaiting = Boolean(node.agentAuto && node.status === "waiting");
    const locked = (options.isGenerating(node) || workflowWaiting) && !(node.kind === "video" && node.role !== "result");
    const flags: NodeDomSyncFlags = {
      selected: node.id === options.selectedId,
      batchSelected: options.batchIds.has(node.id),
      agentReference: options.agentSelecting && options.agentIds.has(node.id),
      locked, workflowWaiting,
      onscreen: screenX + node.width * camera.zoom > -margin && screenX < innerWidth + margin && screenY + node.height * camera.zoom > -margin && screenY < innerHeight + margin,
      editing: options.editingId === node.id, colorTheme: options.colorTheme,
      videoDependency: node.kind === "video" ? (dependencies.get(node.id) ?? []).join("|") : "",
      swapSourceId: options.swap?.videoId === node.id ? options.swap.sourceId : 0,
    };
    styleNodeEditor(element, node, flags);
    const state = nodeDomState(node, flags), previous = options.states.get(node.id);
    if (previous?.element === element && nodeDomStateEquals(previous.value, state)) continue;
    options.states.set(node.id, { element, value: state });
    options.syncNode(element, node, flags);
  }
}
