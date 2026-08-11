import { CanvasGuideController, type CanvasGuideMessage } from "./canvas-guide-controller";
import { ToastController, type ToastType } from "./toast-controller";

export class CanvasFeedbackFeature {
  private readonly guide: CanvasGuideController;
  private readonly toast: ToastController;

  constructor(private readonly options: {
    escapeHtml: (value: string) => string;
    normalizePrompt: (value?: string) => string;
    decodePrompt: (value: string) => string;
  }) {
    this.guide = new CanvasGuideController(options.escapeHtml);
    this.toast = new ToastController(
      document.querySelector<HTMLElement>("#toast-stack")!,
      options.escapeHtml,
      (message) => this.guide.show(message),
    );
  }

  showToast(message: string, type: ToastType = "error", detail = "") {
    this.toast.show(message, type, detail);
  }

  showGuide(message: CanvasGuideMessage) { return this.guide.show(message); }
  hideGuide(key?: string) { this.guide.hide(key); }
  isGuideVisible(key: string) { return this.guide.isVisible(key); }

  showModeNotice(title: string, detail: string) {
    this.showGuide({
      key: "canvas-mode",
      title,
      detail,
      tone: "online",
      priority: 20,
      duration: 2100,
    });
  }

  async copyOriginalPrompt(prompt?: string) {
    const value = this.options.normalizePrompt(prompt);
    if (!value) {
      this.showToast("暂无可复制的原提示词", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(this.options.decodePrompt(value));
      this.showToast("原提示词已复制", "success");
    } catch {
      this.showToast("复制失败，请手动选择提示词", "error");
    }
  }
}
