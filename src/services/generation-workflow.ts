import type { FlowLink, FlowNode } from "../nodes/node-types";

type Options = {
  nodes: FlowNode[]; links: FlowLink[];
  generate: (node: FlowNode) => Promise<void>;
  save: () => void; draw: () => void;
  canGenerate: (node: FlowNode) => boolean;
};

export class GenerationWorkflow {
  private readonly submitting = new Set<number>();
  constructor(private readonly o: Options) {}

  run = () => {
    for (const node of this.o.nodes.filter((item) => item.agentAuto && !this.submitting.has(item.id))) {
      const upstream = this.o.links.filter((link) => link.to === node.id)
        .map((link) => this.o.nodes.find((item) => item.id === link.from))
        .filter((item): item is FlowNode => Boolean(item));
      if (upstream.some((item) => item.status === "failed")) { node.status = "waiting"; continue; }
      if (upstream.some((item) => item.kind === "image" && !item.mediaUrl)) continue;
      this.submitting.add(node.id); node.status = "waiting";
      void this.o.generate(node).finally(() => {
        this.submitting.delete(node.id); this.o.save(); this.o.draw();
      });
    }
  };

  enqueue(ids: Set<number>) {
    const selected = this.o.nodes.filter((node) => ids.has(node.id));
    const candidates = selected.filter((node) => this.o.canGenerate(node) && node.status !== "queued" && node.status !== "running");
    candidates.forEach((node) => { node.agentAuto = true; node.status = "waiting"; });
    const ready = candidates.filter((node) => !this.o.links.filter((link) => link.to === node.id)
      .map((link) => this.o.nodes.find((item) => item.id === link.from))
      .some((upstream) => upstream?.kind === "image" && !upstream.mediaUrl)).length;
    if (candidates.length) { this.o.save(); this.o.draw(); this.run(); }
    return { selected: selected.length, candidates: candidates.length, ready, waiting: candidates.length-ready, skipped: selected.length-candidates.length };
  }
}
