export class AppearanceController {
  private transitioning = false;

  constructor(
    private readonly deps: {
      button: HTMLButtonElement;
      pendingMedia: () => number;
      currentTheme: () => "dark" | "light";
      applyTheme: (theme: "dark" | "light") => void;
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
    this.deps.button.title = pending
      ? `等待 ${pending} 个图片资源加载完成`
      : "切换画布外观";
  }

  private toggle() {
    if (this.transitioning || this.deps.button.disabled) return;
    this.transitioning = true;
    this.refresh();
    document.body.classList.add("theme-click-fade");
    window.setTimeout(() => {
      const theme = this.deps.currentTheme() === "dark" ? "light" : "dark";
      this.deps.applyTheme(theme);
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
