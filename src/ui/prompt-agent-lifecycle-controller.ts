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
  }) {}

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
}
