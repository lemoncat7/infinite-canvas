import { friendlyGenerationError } from "../services/generation-error-presenter";
import type { CanvasGuideMessage } from "./canvas-guide-controller";

export type ToastType = "error" | "success" | "warning" | "info";

export class ToastController {
  constructor(
    private readonly stack: HTMLElement,
    private readonly escapeHtml: (value: string) => string,
    private readonly showGuide: (message: CanvasGuideMessage) => boolean,
  ) {}

  show(message: string, type: ToastType = "error", detail = "") {
    if (type === "info") {
      this.showGuide({
        key: "video-reference-order-guide",
        title: "调整素材顺序",
        detail: detail || message,
        tone: "online",
        priority: 44,
        duration: 4200,
        smart: { kind: "assist", cooldownMs: 3 * 864e5, maxShows: 3, dismissible: true },
      });
      return;
    }
    const toast = document.createElement("div");
    const raw = detail || message;
    const friendly = type === "error" ? friendlyGenerationError(raw, message) : null;
    const successTitle = /登录/.test(message)
      ? "登录成功"
      : /生成|创建|加入资产库/.test(message)
        ? "生成完成"
        : /保存|更新|重命名|复制/.test(message)
          ? "保存完成"
          : "操作完成";
    const title = friendly?.title || (type === "success" ? successTitle : type === "warning" ? "提示" : "操作失败");
    toast.className = `app-toast ${type}`;
    toast.innerHTML = `<i>${type === "error" ? "!" : type === "success" ? "✓" : "i"}</i><span><b>${this.escapeHtml(title)}</b><small>${this.escapeHtml(friendly?.message || message)}</small>${friendly ? `<p>${this.escapeHtml(friendly.advice)}</p><details><summary>技术详情</summary><em>${this.escapeHtml(raw)}${friendly.requestId ? `\nRequest ID: ${this.escapeHtml(friendly.requestId)}` : ""}</em></details>` : detail ? `<em>${this.escapeHtml(detail)}</em>` : ""}</span><button type="button" aria-label="关闭">×</button>`;
    let timer = type === "error" ? 0 : window.setTimeout(() => toast.remove(), type === "warning" ? 9000 : 6000);
    toast.querySelector("button")!.addEventListener("click", () => {
      window.clearTimeout(timer);
      toast.remove();
    });
    toast.querySelector("details")?.addEventListener("toggle", (event) => {
      if (type === "error") return;
      if ((event.currentTarget as HTMLDetailsElement).open) window.clearTimeout(timer);
      else timer = window.setTimeout(() => toast.remove(), 12000);
    });
    this.stack.append(toast);
    while (this.stack.children.length > 3) this.stack.firstElementChild?.remove();
  }
}
