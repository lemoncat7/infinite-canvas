import type { FlowLink, FlowNode } from "../nodes/node-types";
import type { CanvasSyncSnapshot } from "./sync";

export class CanvasSnapshotController {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    selectedId: () => number;
    setSelectedId: (id: number) => void;
    serverVersion: () => number;
    serverUpdatedAt: () => string;
    syncCameraTarget: () => void;
    ensureNodeIdAtLeast: (value: number) => void;
    updateEditor: () => void;
    draw: () => void;
  }) {}

  capture(version?: number, updatedAt?: string): CanvasSyncSnapshot {
    return {
      nodes: structuredClone(this.options.nodes),
      links: structuredClone(this.options.links),
      camera: { ...this.options.camera },
      version: version ?? this.options.serverVersion(),
      updatedAt: updatedAt ?? this.options.serverUpdatedAt(),
    };
  }

  apply(snapshot: CanvasSyncSnapshot, preserveSelection = true) {
    const { nodes, links, camera } = this.options;
    const selected = preserveSelection ? this.options.selectedId() : 0;
    const currentNodes = new Map(nodes.map((node) => [String(node.id), node]));
    const mergedNodes = snapshot.nodes.map((source) => {
      const current = currentNodes.get(String(source.id));
      if (!current) return structuredClone(source);
      const mutable = current as unknown as Record<string, unknown>;
      for (const key of Object.keys(mutable))
        if (!(key in source)) delete mutable[key];
      Object.assign(current, structuredClone(source));
      return current;
    });
    nodes.splice(0, nodes.length, ...mergedNodes);
    links.splice(0, links.length, ...structuredClone(snapshot.links));
    Object.assign(camera, snapshot.camera);
    this.options.syncCameraTarget();
    this.options.ensureNodeIdAtLeast(
      nodes.length ? Math.max(...nodes.map((node) => node.id)) + 1 : 1,
    );
    this.options.setSelectedId(
      nodes.some((node) => node.id === selected) ? selected : 0,
    );
    this.options.updateEditor();
    this.options.draw();
  }
}
