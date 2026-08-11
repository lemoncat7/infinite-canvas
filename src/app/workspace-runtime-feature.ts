import { GenerationCapabilitiesController } from "../services/generation-capabilities-controller";
import { WorkspaceKeyboardController } from "../ui/workspace-keyboard-controller";
import { WorkspaceOverlayController } from "../ui/workspace-overlay-controller";
import { ApplicationBootstrapController } from "./application-bootstrap-controller";

export class WorkspaceRuntimeFeature<User> {
  private readonly capabilities: GenerationCapabilitiesController;
  private readonly bootstrap: ApplicationBootstrapController<User>;

  constructor(options: {
    capabilities: ConstructorParameters<typeof GenerationCapabilitiesController>[0];
    bootstrap: ConstructorParameters<typeof ApplicationBootstrapController<User>>[0];
    keyboard: ConstructorParameters<typeof WorkspaceKeyboardController>[0];
    overlay: ConstructorParameters<typeof WorkspaceOverlayController>[0];
  }) {
    this.capabilities = new GenerationCapabilitiesController(options.capabilities);
    this.bootstrap = new ApplicationBootstrapController<User>({
      ...options.bootstrap,
      loadCapabilities: () => this.loadCapabilities(),
    });
    new WorkspaceOverlayController(options.overlay).bind();
    new WorkspaceKeyboardController(options.keyboard);
  }

  loadCapabilities = (redraw = false) => this.capabilities.load(redraw);

  start(resize: () => void, updateEditor: () => void) {
    window.addEventListener("resize", resize);
    resize();
    updateEditor();
    void this.bootstrap.run();
  }
}
