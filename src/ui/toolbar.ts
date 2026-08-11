export class WorkspacePanelController {
  constructor(
    private readonly panels: NodeListOf<HTMLElement>,
    private readonly backdrop: HTMLElement,
    private readonly brand: HTMLElement,
    private readonly mobileToggle: HTMLButtonElement,
    private readonly onClose: () => void,
  ) {}

  closeMobileMenu() {
    this.brand.classList.remove("mobile-menu-open");
    this.mobileToggle.setAttribute("aria-expanded", "false");
  }

  close() {
    this.panels.forEach((panel) => panel.classList.remove("open"));
    this.backdrop.classList.remove("open");
    document
      .querySelectorAll(".main-nav button")
      .forEach((button) => button.classList.remove("active"));
    this.closeMobileMenu();
    this.onClose();
  }

  open(panel: HTMLElement, trigger: HTMLElement) {
    this.close();
    panel.classList.add("open");
    this.backdrop.classList.add("open");
    trigger.classList.add("active");
  }
}
