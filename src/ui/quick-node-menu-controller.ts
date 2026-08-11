import type { FlowNode, NodeKind, Point } from "../nodes/node-types";

export class QuickNodeMenuController {
  private position: Point | null = null;

  constructor(
    private readonly deps: {
      canvas: HTMLElement;
      menu: HTMLElement;
      connectionActive: () => boolean;
      hitNode: (clientX: number, clientY: number) => FlowNode | null | undefined;
      selectNode: (node: FlowNode) => void;
      previewNode: (node: FlowNode) => void;
      editPromptNode: (node: FlowNode) => void;
      multiSelectActive: () => boolean;
      exitMultiSelect: () => void;
      enterMultiSelect: () => void;
      toWorld: (point: Point) => Point;
      addNode: (kind: NodeKind, position: Point) => void;
      uploadAt: (position: Point | null) => void;
    },
  ) {
    this.bind();
  }

  close() {
    this.deps.menu.classList.remove("open");
    this.position = null;
  }

  private bind() {
    this.deps.canvas.addEventListener("dblclick", (event) => {
      if (event.button !== 0 || this.deps.connectionActive()) return;
      const hit = this.deps.hitNode(event.clientX, event.clientY);
      if (hit) {
        event.preventDefault();
        this.deps.selectNode(hit);
        if (hit.mediaUrl && (hit.kind === "image" || hit.kind === "video"))
          this.deps.previewNode(hit);
        else if (hit.kind === "prompt")
          requestAnimationFrame(() => this.deps.editPromptNode(hit));
        return;
      }
      event.preventDefault();
      if (this.deps.multiSelectActive()) {
        this.deps.exitMultiSelect();
        return;
      }
      this.position = this.deps.toWorld({ x: event.clientX, y: event.clientY });
      this.deps.menu.classList.remove("open");
      requestAnimationFrame(() => {
        this.deps.menu.classList.add("open");
        this.place(event.clientX, event.clientY);
      });
    });
    this.deps.menu
      .querySelectorAll<HTMLButtonElement>("[data-quick-add]")
      .forEach((button) =>
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (this.position)
            this.deps.addNode(
              button.dataset.quickAdd as NodeKind,
              this.position,
            );
          this.close();
        }),
      );
    this.deps.menu
      .querySelector<HTMLButtonElement>("[data-quick-upload]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        const position = this.position;
        this.close();
        this.deps.uploadAt(position);
      });
    this.deps.menu
      .querySelector<HTMLButtonElement>("[data-quick-multi]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        this.close();
        this.deps.enterMultiSelect();
      });
  }

  private place(clientX: number, clientY: number) {
    const margin = 12;
    const gap = 12;
    const width = this.deps.menu.offsetWidth || 304;
    const height = this.deps.menu.offsetHeight;
    const left = Math.max(
      margin,
      Math.min(clientX + gap, innerWidth - width - margin),
    );
    const spaceBelow = innerHeight - clientY - gap - margin;
    const spaceAbove = clientY - gap - margin;
    const openUp = height > spaceBelow && spaceAbove > spaceBelow;
    const top = openUp
      ? Math.max(margin, clientY - gap - height)
      : Math.min(clientY + gap, innerHeight - height - margin);
    this.deps.menu.style.left = `${left}px`;
    this.deps.menu.style.top = `${Math.max(margin, top)}px`;
    this.deps.menu.classList.toggle("opens-up", openUp);
  }
}
