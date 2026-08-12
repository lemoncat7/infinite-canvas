import type { ThemePreference } from "../services/theme-preference";

export class AppearanceController {
  private transitioning = false;

  constructor(
    private readonly deps: {
      button: HTMLButtonElement;
      pendingMedia: () => number;
      currentTheme: () => "dark" | "light";
      currentPreference: () => ThemePreference;
      cycleTheme: () => void;
      repaintMedia: () => void;
      paint: () => void;
    },
  ) {
    deps.button.addEventListener("click", () => this.toggle());
    this.refresh();
  }

  refresh() {
    const pending = this.deps.pendingMedia();
    this.deps.button.disabled = this.transitioning || pending > 0;
    const preference = this.deps.currentPreference();
    const label = preference === "auto" ? `自动 · ${this.deps.currentTheme() === "light" ? "浅色" : "深色"}` : preference === "light" ? "浅色" : "深色";
    this.deps.button.querySelector("span")!.textContent = label;
    this.deps.button.title = pending
      ? `等待 ${pending} 个图片资源加载完成`
      : `主题：${label}（点击切换）`;
  }

  private toggle() {
    if (this.transitioning || this.deps.button.disabled) return;
    this.transitioning = true;
    this.refresh();
    document.body.classList.add("theme-click-fade");
    window.setTimeout(() => {
      this.deps.cycleTheme();
      this.deps.repaintMedia();
      this.deps.paint();
      document.body.classList.add("theme-click-return");
      document.body.classList.remove("theme-click-fade");
    }, 90);
    window.setTimeout(() => {
      document.body.classList.remove("theme-click-return");
      this.transitioning = false;
      this.refresh();
    }, 260);
  }
}
