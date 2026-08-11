import type { FlowNode } from "../nodes/node-types";
import { MediaLifecycleController } from "./media-lifecycle-controller";
import { NodeMediaRenderer } from "./node-media-renderer";

export class CanvasMediaFeature {
  private readonly lifecycle: MediaLifecycleController;
  private readonly renderer: NodeMediaRenderer;

  constructor(options: {
    mobile: boolean;
    nodes: FlowNode[];
    nodeLayer: HTMLElement;
    theme: () => "dark" | "light";
    suspendRenderer: () => void;
    resumeRenderer: () => void;
    clearNodeStates: () => void;
    invalidateNode: (id: number) => void;
    resize: () => void;
    draw: (syncDom?: boolean) => void;
    refreshAppearance: () => void;
  }) {
    this.lifecycle = new MediaLifecycleController({
      mobile: options.mobile,
      nodeLayer: options.nodeLayer,
      suspendRenderer: options.suspendRenderer,
      resumeRenderer: options.resumeRenderer,
      clearNodeStates: options.clearNodeStates,
      resize: options.resize,
      draw: options.draw,
    });
    this.renderer = new NodeMediaRenderer({
      lifecycle: this.lifecycle,
      nodes: options.nodes,
      nodeLayer: options.nodeLayer,
      theme: options.theme,
      invalidateNode: options.invalidateNode,
      draw: options.draw,
      refreshAppearance: options.refreshAppearance,
    });
  }

  get pendingLoads() { return this.lifecycle.pendingLoads; }
  get cache() { return this.lifecycle.cache; }
  paint(target: HTMLCanvasElement, url: string) { this.renderer.paint(target, url); }
  repaintUrl(url: string) { this.renderer.repaintUrl(url); }
  repaintAll() { this.renderer.repaintAll(); }
}
