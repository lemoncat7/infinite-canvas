import type { FlowLink, FlowNode } from "./node-types";

export class GenerationGraph {
  constructor(private readonly nodes: FlowNode[], private readonly links: FlowLink[]) {}

  isActive(node: FlowNode | undefined) {
    return node?.status === "queued" || node?.status === "running";
  }

  hasActiveGeneration() {
    return this.nodes.some((node) => this.isActive(node));
  }

  feedsActiveGeneration(nodeId: number) {
    const visited = new Set<number>();
    const pending = [nodeId];
    while (pending.length) {
      const currentId = pending.pop()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      if (currentId !== nodeId && this.isActive(this.nodes.find((node) => node.id === currentId))) return true;
      this.links.filter((link) => link.from === currentId).forEach((link) => pending.push(link.to));
    }
    return false;
  }

  isProtected(node: FlowNode) {
    return this.isActive(node) || this.feedsActiveGeneration(node.id);
  }

  orderedImageInputs(targetId: number) {
    return this.links
      .filter((link) => link.to === targetId)
      .map((link) => ({ link, node: this.nodes.find((node) => node.id === link.from) }))
      .filter((input): input is { link: FlowLink; node: FlowNode } => Boolean(input.node?.kind === "image" && input.node.mediaUrl))
      .sort((left, right) => left.node.y - right.node.y || left.node.x - right.node.x || left.node.id - right.node.id);
  }

  imageInputOrder(link: FlowLink) {
    const index = this.orderedImageInputs(link.to).findIndex((input) => input.link === link);
    return index < 0 ? undefined : index + 1;
  }

  orderedTargetLinks(targetId: number) {
    return this.links
      .filter((link) => link.to === targetId)
      .map((link, originalIndex) => ({ link, originalIndex, source: this.nodes.find((node) => node.id === link.from) }))
      .sort((left, right) =>
        (left.link.inputOrder ?? Number.MAX_SAFE_INTEGER) - (right.link.inputOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.source?.y ?? 0) - (right.source?.y ?? 0) ||
        (left.source?.x ?? 0) - (right.source?.x ?? 0) ||
        left.originalIndex - right.originalIndex,
      )
      .map((item) => item.link);
  }
}
