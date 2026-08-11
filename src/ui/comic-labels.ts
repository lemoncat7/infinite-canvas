import type { FlowNode } from "../nodes/node-types";

interface ComicLabelControllerOptions {
  studio: HTMLElement;
  getLabels: () => FlowNode[];
  getLinkedId: () => number;
  onSelect: (label: FlowNode) => void;
  onUnlink: () => void;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class ComicLabelController {
  constructor(private readonly options: ComicLabelControllerOptions) {}

  renderState() {
    const { studio } = this.options;
    const linked = this.options
      .getLabels()
      .find((node) => node.id === this.options.getLinkedId());
    const card = studio.querySelector<HTMLElement>("[data-comic-linked-label]")!;
    const picker = studio.querySelector<HTMLButtonElement>("[data-comic-label-picker]")!;
    const save = studio.querySelector<HTMLButtonElement>("[data-comic-label]")!;
    const copy = studio.querySelector<HTMLButtonElement>("[data-comic-label-copy]")!;
    picker.querySelector("b")!.textContent = linked ? "更换标签" : "关联标签";
    card.hidden = !linked;
    card.innerHTML = linked
      ? `<span><i>◇</i><span><small>正在延续</small><b>${escapeHtml(linked.title)}</b></span></span><button type="button" aria-label="取消关联">×</button>`
      : "";
    card.querySelector("button")?.addEventListener("click", this.options.onUnlink);
    save.querySelector("span")!.textContent = linked ? "更新原标签" : "保存为标签";
    copy.hidden = !linked;
  }

  renderMenu() {
    const { studio } = this.options;
    const menu = studio.querySelector<HTMLElement>("[data-comic-label-menu]")!;
    const labels = this.options.getLabels();
    const linkedId = this.options.getLinkedId();
    menu.innerHTML = `<header><b>选择故事标签</b><small>读取后可继续对话修改</small></header>${labels.length ? labels.map((label) => `<button type="button" data-comic-label-id="${label.id}" class="${label.id === linkedId ? "active" : ""}"><i>◇</i><span><b>${escapeHtml(label.title || "未命名标签")}</b><small>${escapeHtml(label.body.replace(/\s+/g, " ").trim().slice(0, 90) || "暂无内容")}</small></span><em>${label.id === linkedId ? "✓" : "›"}</em></button>`).join("") : "<p>当前画布还没有可用标签</p>"}`;
    menu
      .querySelectorAll<HTMLButtonElement>("[data-comic-label-id]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const label = labels.find(
            (node) => node.id === Number(button.dataset.comicLabelId),
          );
          if (!label) return;
          this.options.onSelect(label);
          menu.classList.remove("open");
        }),
      );
  }
}
