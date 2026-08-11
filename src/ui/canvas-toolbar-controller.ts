import type { NodeKind } from "../nodes/node-types";

export class CanvasToolbarController {
  constructor(private readonly options: {
    zoomSlider: HTMLInputElement;
    viewportCenter: () => { x: number; y: number };
    fit: () => void;
    setZoom: (zoom: number, anchor: { x: number; y: number }) => void;
    zoomBy: (factor: number, anchor: { x: number; y: number }) => void;
    addNode: (kind: NodeKind) => void;
    generate: () => void;
    deleteSelected: () => void;
  }) {}

  bind() {
    document.querySelector("#reset")!.addEventListener("click", this.options.fit);
    document.querySelector("#mobile-fit-canvas")!.addEventListener("click", this.options.fit);
    this.options.zoomSlider.addEventListener("input", () =>
      this.options.setZoom(Number(this.options.zoomSlider.value) / 100, this.options.viewportCenter()),
    );
    document.querySelector("#zoom-in")!.addEventListener("click", () =>
      this.options.zoomBy(1.15, this.options.viewportCenter()),
    );
    document.querySelector("#zoom-out")!.addEventListener("click", () =>
      this.options.zoomBy(1 / 1.15, this.options.viewportCenter()),
    );
    document.querySelector("#quick-create")!.addEventListener("click", () =>
      this.options.addNode("image"),
    );
    document.querySelector("#generate")!.addEventListener("click", this.options.generate);
    document.querySelector("#delete-node")!.addEventListener("click", this.options.deleteSelected);
    document.querySelectorAll<HTMLElement>("[data-add]").forEach((button) =>
      button.addEventListener("click", () =>
        this.options.addNode(button.dataset.add as NodeKind),
      ),
    );
  }
}
