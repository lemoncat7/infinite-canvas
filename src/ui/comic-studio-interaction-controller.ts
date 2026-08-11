export class ComicStudioInteractionController {
  private readonly message: HTMLTextAreaElement;

  constructor(private readonly options: {
    studio: HTMLElement;
    briefPanel: HTMLElement;
    planPanel: HTMLElement;
    headerNav: HTMLElement;
    submitting: () => boolean;
    close: () => void;
    newSession: () => void;
    send: (message: string) => void;
    requestPlan: () => void;
    applyCanvas: () => void;
    saveLabel: (copy: boolean) => void;
    closeMobilePanel: () => void;
    renderLabelMenu: () => void;
  }) {
    this.message = options.studio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!;
  }

  bind() {
    const { studio, briefPanel } = this.options;
    studio.querySelector("[data-comic-close]")!.addEventListener("click", this.options.close);
    studio.querySelector("[data-comic-new]")!.addEventListener("click", this.options.newSession);
    studio.querySelector("[data-comic-send]")!.addEventListener("click", () => this.send());
    briefPanel.querySelector("[data-comic-confirm]")!.addEventListener("click", this.options.requestPlan);
    this.message.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!this.options.submitting()) this.send();
    });
    studio.querySelector("[data-comic-canvas]")!.addEventListener("click", this.options.applyCanvas);
    studio.querySelector("[data-comic-label-picker]")!.addEventListener("click", (event) => this.toggleLabelMenu(event));
    studio.querySelector("[data-comic-label]")!.addEventListener("click", () => this.options.saveLabel(false));
    studio.querySelector("[data-comic-label-copy]")!.addEventListener("click", () => this.options.saveLabel(true));
    studio.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement).closest(".comic-label-control")) this.closeLabelMenu();
    });
    document.addEventListener("pointerdown", (event) => this.handleMobileOutside(event), true);
  }

  private send() {
    if (this.options.submitting()) return;
    const value = this.message.value.trim();
    if (!value) return;
    this.message.value = "";
    this.options.send(value);
  }

  private labelMenu() {
    return this.options.studio.querySelector<HTMLElement>("[data-comic-label-menu]")!;
  }

  private closeLabelMenu() {
    this.labelMenu().classList.remove("open");
  }

  private toggleLabelMenu(event: Event) {
    event.stopPropagation();
    const menu = this.labelMenu();
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      return;
    }
    this.options.closeMobilePanel();
    this.options.renderLabelMenu();
    menu.classList.add("open");
  }

  private handleMobileOutside(event: PointerEvent) {
    if (innerWidth > 780) return;
    const target = event.target as Node;
    const scheme = this.options.headerNav.querySelector<HTMLElement>("[data-comic-scheme]");
    const labelControl = this.options.studio.querySelector<HTMLElement>(".comic-label-control");
    const insideScheme = this.options.briefPanel.contains(target) || this.options.planPanel.contains(target);
    if (!insideScheme && !scheme?.contains(target)) this.options.closeMobilePanel();
    if (!labelControl?.contains(target)) this.closeLabelMenu();
  }
}
