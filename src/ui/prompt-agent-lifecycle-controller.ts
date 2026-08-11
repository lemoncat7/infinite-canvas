export class PromptAgentLifecycleController {
  constructor(private readonly options: {
    panel: HTMLElement;
    trigger: HTMLElement;
    cancelFormation: () => void;
    cancelRequest: () => void;
    clearResult: () => void;
    clearContext: () => void;
    setSelecting: (value: boolean) => void;
    draw: () => void;
    disperseDirect: () => void;
    position: () => void;
  }) {}

  bindWindow() {
    window.addEventListener("contextmenu", this.handleContextMenu, true);
    window.addEventListener("resize", this.handleResize);
  }

  close() {
    this.options.cancelFormation();
    this.options.cancelRequest();
    this.options.panel.querySelector(".agent-submit")?.classList.remove("is-running");
    this.options.panel.classList.remove("open", "forming");
    this.options.trigger.classList.remove("active");
    this.options.setSelecting(false);
    this.options.clearContext();
    this.options.clearResult();
    this.options.draw();
  }

  cancelRequest() {
    this.options.cancelRequest();
  }

  private handleContextMenu = (event: MouseEvent) => {
    if (!this.options.panel.classList.contains("open")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.options.cancelRequest();
    this.options.disperseDirect();
  };

  private handleResize = () => {
    if (this.options.panel.classList.contains("open")) this.options.position();
  };
}
