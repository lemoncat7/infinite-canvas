import { LinkInteractionView } from "../canvas/link-interaction-view";
import { AppearanceController } from "./appearance-controller";
import { CanvasToolbarController } from "./canvas-toolbar-controller";
import { QuickNodeMenuController } from "./quick-node-menu-controller";

export class CanvasControlsFeature {
  readonly quickMenu = document.querySelector<HTMLElement>("#quick-node-menu")!;
  private readonly quickMenuController: QuickNodeMenuController;
  private readonly appearance: AppearanceController;

  constructor(options: {
    link: Omit<ConstructorParameters<typeof LinkInteractionView>[0], "hint" | "touchAction">;
    toolbar: ConstructorParameters<typeof CanvasToolbarController>[0];
    quickMenu: Omit<ConstructorParameters<typeof QuickNodeMenuController>[0], "menu">;
    appearance: Omit<ConstructorParameters<typeof AppearanceController>[0], "button">;
  }) {
    new LinkInteractionView({
      ...options.link,
      hint: document.querySelector<HTMLElement>("#link-hover-hint")!,
      touchAction: document.querySelector<HTMLButtonElement>("#touch-link-action")!,
    });
    new CanvasToolbarController(options.toolbar).bind();
    this.quickMenuController = new QuickNodeMenuController({
      ...options.quickMenu,
      menu: this.quickMenu,
    });
    this.appearance = new AppearanceController({
      ...options.appearance,
      button: document.querySelector<HTMLButtonElement>("#dock-appearance")!,
    });
  }

  closeQuickMenu = () => this.quickMenuController.close();
  refreshAppearance = () => this.appearance.refresh();
}
