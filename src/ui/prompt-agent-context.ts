import type { FlowLink, FlowNode } from "../nodes/node-types";

type PromptAgentContextOptions = {
  panel: HTMLElement;
  selectedIds: Set<number>;
  getNodes: () => readonly FlowNode[];
  getLinks: () => readonly FlowLink[];
  getPrimarySelectedId: () => number;
  onChanged: () => void;
};

export class PromptAgentContextController {
  constructor(private readonly options: PromptAgentContextOptions) {}

  selectedNodes() {
    const nodes = this.options.getNodes();
    return [...this.options.selectedIds]
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is FlowNode => Boolean(node));
  }

  render(reset = false) {
    const nodes = this.options.getNodes();
    const contexts = this.collect();
    if (reset) {
      this.options.selectedIds.clear();
      contexts.forEach((node) => this.options.selectedIds.add(node.id));
    } else {
      for (const id of this.options.selectedIds)
        if (!nodes.some((node) => node.id === id))
          this.options.selectedIds.delete(id);
    }
    const list = this.options.panel.querySelector<HTMLElement>(
      "[data-agent-context-list]",
    )!;
    const selected = this.selectedNodes();
    const hint = this.options.panel.querySelector<HTMLElement>(
      ".agent-selection-hint",
    )!;
    this.options.panel.classList.toggle("has-materials", selected.length > 0);
    hint.querySelector("span")!.textContent = selected.length
      ? `已选择 ${selected.length} 个素材 · 点击卡片可增减`
      : "点击卡片选择素材";
    if (!selected.length) {
      list.innerHTML = "<small>点击卡片添加素材</small>";
      return;
    }
    list.innerHTML = selected
      .map(
        (node, index) =>
          `<button type="button" class="active" title="${escapeHtml(node.title)}" data-agent-context-node="${node.id}">${node.mediaUrl && node.kind === "image" ? `<img src="${escapeHtml(node.mediaUrl)}" alt="">` : `<i>${node.kind === "image" ? "▧" : node.kind === "video" ? "▶" : "T"}</i>`}<span><b>素材 ${index + 1}</b><small>${escapeHtml(node.title)}</small></span><em>✓</em></button>`,
      )
      .join("");
    list
      .querySelectorAll<HTMLButtonElement>("[data-agent-context-node]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          this.options.selectedIds.delete(Number(button.dataset.agentContextNode));
          this.render(false);
          this.options.onChanged();
        }),
      );
  }

  private collect() {
    const nodes = this.options.getNodes();
    const links = this.options.getLinks();
    const selected = nodes.find(
      (node) => node.id === this.options.getPrimarySelectedId(),
    );
    const result: FlowNode[] = [];
    const seen = new Set<number>();
    const visit = (node: FlowNode) => {
      if (seen.has(node.id) || result.length >= 8) return;
      seen.add(node.id);
      result.push(node);
      links
        .filter((link) => link.to === node.id)
        .map((link) => nodes.find((item) => item.id === link.from))
        .filter((item): item is FlowNode => Boolean(item))
        .sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id)
        .forEach(visit);
    };
    for (const id of this.options.selectedIds) {
      const node = nodes.find((item) => item.id === id);
      if (node) visit(node);
    }
    if (selected) visit(selected);
    return result;
  }
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
