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

  bindNavigation(options: {
    projectsButton: HTMLElement;
    projectsPanel: HTMLElement;
    assetsButton: HTMLElement;
    assetsPanel: HTMLElement;
    squareButton: HTMLElement;
    squarePanel: HTMLElement;
    mainNav: HTMLElement;
    closeButtons: NodeListOf<HTMLElement>;
    onProjectsOpen: () => void;
    onAssetsOpen: () => void;
    onSquareOpen: () => void;
    onMobileToggle: (opening: boolean) => void;
  }) {
    options.projectsButton.addEventListener("click", () => {
      this.open(options.projectsPanel, options.projectsButton);
      options.onProjectsOpen();
    });
    options.assetsButton.addEventListener("click", () => {
      this.open(options.assetsPanel, options.assetsButton);
      options.onAssetsOpen();
    });
    options.squareButton.addEventListener("click", () => {
      this.open(options.squarePanel, options.squareButton);
      options.onSquareOpen();
    });
    this.mobileToggle.addEventListener("click", (event) => {
      if (innerWidth > 780) return;
      event.stopPropagation();
      const opening = !this.brand.classList.contains("mobile-menu-open");
      options.onMobileToggle(opening);
      this.brand.classList.toggle("mobile-menu-open", opening);
      this.mobileToggle.setAttribute("aria-expanded", String(opening));
    });
    options.mainNav.addEventListener("click", (event) =>
      event.stopPropagation(),
    );
    document.addEventListener("click", () => this.closeMobileMenu());
    window.addEventListener("resize", () => {
      if (innerWidth > 780) this.closeMobileMenu();
    });
    options.closeButtons.forEach((button) =>
      button.addEventListener("click", () => this.close()),
    );
    this.backdrop.addEventListener("click", () => this.close());
  }
}
