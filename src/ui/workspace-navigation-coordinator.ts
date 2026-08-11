import type { WorkspacePanelController } from "./toolbar";

export class WorkspaceNavigationCoordinator {
  constructor(private readonly options: {
    panels: WorkspacePanelController;
    brand: HTMLElement;
    hasAssets: () => boolean;
    loadAssets: () => Promise<unknown>;
    renderAssets: () => void;
    loadProjects: () => void;
    loadSquare: () => void;
    toggleTopbar: (opening: boolean) => void;
  }) {}

  bind() {
    this.options.panels.bindNavigation({
      projectsButton: document.querySelector<HTMLElement>("#open-projects")!,
      projectsPanel: document.querySelector<HTMLElement>("#projects-panel")!,
      assetsButton: document.querySelector<HTMLElement>("#open-assets")!,
      assetsPanel: document.querySelector<HTMLElement>("#assets-panel")!,
      squareButton: document.querySelector<HTMLElement>("#open-square")!,
      squarePanel: document.querySelector<HTMLElement>("#square-panel")!,
      mainNav: this.options.brand.querySelector<HTMLElement>(".main-nav")!,
      closeButtons: document.querySelectorAll<HTMLElement>(".panel-close"),
      onProjectsOpen: this.options.loadProjects,
      onAssetsOpen: () => {
        if (!this.options.hasAssets())
          void this.options.loadAssets().then(() => this.renderAssetsAfterOpen());
        else this.renderAssetsAfterOpen();
      },
      onSquareOpen: this.options.loadSquare,
      onMobileToggle: this.options.toggleTopbar,
    });
  }

  private renderAssetsAfterOpen() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.querySelector("#assets-panel")?.classList.contains("open"))
        this.options.renderAssets();
    }));
  }
}
