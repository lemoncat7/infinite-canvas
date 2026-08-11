import { GenerationGraph } from "./generation-graph";
import { NodeLifecycleController } from "./node-lifecycle-controller";
import type { FlowLink, FlowNode, NodeKind, Point } from "./node-types";

type LifecycleOptions = ConstructorParameters<typeof NodeLifecycleController>[0];

export class CanvasNodeLifecycleFeature {
  private readonly graph: GenerationGraph;
  private readonly lifecycle: NodeLifecycleController;

  constructor(options: Omit<LifecycleOptions, "hasActiveGeneration">) {
    this.graph = new GenerationGraph(options.nodes, options.links);
    this.lifecycle = new NodeLifecycleController({
      ...options,
      hasActiveGeneration: () => this.graph.hasActiveGeneration(),
    });
  }

  isActive = (node: FlowNode | undefined) => this.graph.isActive(node);
  hasActiveGeneration = () => this.graph.hasActiveGeneration();
  orderedImageInputs = (targetId: number) => this.graph.orderedImageInputs(targetId);
  imageInputOrder = (link: FlowLink) => this.graph.imageInputOrder(link);
  orderedTargetLinks = (targetId: number) => this.graph.orderedTargetLinks(targetId);
  add = (kind: NodeKind = "image", position?: Point, deferRender = false) =>
    this.lifecycle.add(kind, position, deferRender);
  addMedia = (
    url: string,
    title: string,
    position: Point,
    kind: "image" | "video" = "image",
  ) => this.lifecycle.addMedia(url, title, position, kind);
  deleteSelected = () => this.lifecycle.deleteSelected();
}
