export class WorkspaceOverlayController {
  constructor(private readonly options: {
    quickMenu: HTMLElement;
    closeQuickMenu: () => void;
    closeAssetContextIfOutside: (target: Node) => void;
  }) {}

  bind() {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (!this.options.quickMenu.contains(target)) this.options.closeQuickMenu();
      this.options.closeAssetContextIfOutside(target);
      document
        .querySelectorAll<HTMLDetailsElement>(
          ".image-config-panel details[open],.video-config-panel details[open],.voice-config-panel details[open]",
        )
        .forEach((details) => {
          if (!details.contains(target)) details.open = false;
        });
    });
  }
}
