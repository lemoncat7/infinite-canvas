import type { FlowLink, FlowNode } from "../nodes/node-types";
import type { CanvasCamera } from "./store";

export class CanvasClearResultApplier {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    camera: CanvasCamera;
    normalizeLinks: (links: FlowLink[]) => FlowLink[];
    applySnapshot: (version: number, updatedAt?: string) => void;
    clearSelection: () => void;
    resetHistory: () => void;
    updateEditor: () => void;
    markSaved: () => void;
    draw: () => void;
    notify: (count: number) => void;
  }) {}

  apply(result: {
    version: number;
    updatedAt?: string;
    nodes: FlowNode[];
    links: FlowLink[];
    camera?: CanvasCamera;
  }) {
    this.options.nodes.splice(0, this.options.nodes.length, ...result.nodes);
    this.options.links.splice(0, this.options.links.length, ...this.options.normalizeLinks(result.links));
    if (result.camera) Object.assign(this.options.camera, result.camera);
    this.options.applySnapshot(result.version, result.updatedAt);
    this.options.clearSelection();
    this.options.resetHistory();
    this.options.updateEditor();
    this.options.markSaved();
    this.options.draw();
    this.options.notify(this.options.nodes.length);
  }
}
