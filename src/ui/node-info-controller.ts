import { makeNodePublicId } from "../nodes/node-service";
import type { FlowNode } from "../nodes/node-types";

export class NodeInfoController {
  private readonly details: HTMLElement;
  private readonly json: HTMLElement;

  constructor(
    private readonly modal: HTMLElement,
    private readonly save: () => void,
  ) {
    this.details = document.querySelector<HTMLElement>("#node-info-details")!;
    this.json = document.querySelector<HTMLElement>("#node-info-json")!;
    document.querySelector("#close-node-info")!.addEventListener("click", this.close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) this.close();
    });
    modal.querySelectorAll<HTMLElement>("[data-info-tab]").forEach((button) =>
      button.addEventListener("click", () => this.selectTab(button)),
    );
  }

  get isOpen() { return this.modal.classList.contains("open"); }

  open(node: FlowNode) {
    const info = this.data(node);
    const typeLabel = node.kind === "prompt"
      ? "标签"
      : node.kind === "image"
        ? "图片"
        : node.kind === "video"
          ? "视频"
          : "便签";
    this.details.innerHTML = `<dl><div><dt>ID</dt><dd>${escapeHtml(info.id)}</dd></div><div><dt>名称</dt><dd>${escapeHtml(info.title)}</dd></div><div><dt>类型</dt><dd>${typeLabel}</dd></div><div><dt>尺寸</dt><dd>${Math.round(info.width)} × ${Math.round(info.height)}</dd></div><div><dt>位置</dt><dd>${Math.round(info.position.x)}, ${Math.round(info.position.y)}</dd></div><div><dt>状态</dt><dd><i></i>${escapeHtml(info.metadata.status)}</dd></div></dl>`;
    this.json.textContent = JSON.stringify(info, null, 2);
    this.selectTab(this.modal.querySelector<HTMLElement>('[data-info-tab="details"]')!);
    this.modal.classList.add("open");
    this.save();
  }

  close = () => { this.modal.classList.remove("open"); };

  private data(node: FlowNode) {
    node.publicId ||= makeNodePublicId(node.kind);
    return {
      id: node.publicId,
      type: node.kind === "prompt" ? "label" : node.kind,
      title: node.title,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      metadata: {
        content: node.body,
        status: node.status ?? "idle",
        fontSize: Math.round(12 * (node.fontScale ?? 1)),
      },
    };
  }

  private selectTab(button: HTMLElement) {
    const showJson = button.dataset.infoTab === "json";
    this.details.hidden = showJson;
    this.json.hidden = !showJson;
    this.modal.querySelectorAll("[data-info-tab]").forEach((item) =>
      item.classList.toggle("active", item === button),
    );
  }
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
