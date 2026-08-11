import { CanvasConnectionController } from "../canvas/connection-controller";
import { CanvasInteractionController } from "../canvas/interaction-controller";
import { CanvasSelectionController } from "../canvas/selection-controller";
import { CanvasStore } from "../canvas/store";
import type { FlowLink, FlowNode, Point } from "../nodes/node-types";
import { PromptNodeController } from "../nodes/prompt-node";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required runtime element is missing: ${selector}`);
  return element;
}

export class RuntimeFoundation {
  readonly dom = {
    canvas: requiredElement<HTMLElement>("#canvas"),
    nodeViewport: requiredElement<HTMLElement>("#node-viewport"),
    nodeLayer: requiredElement<HTMLElement>("#node-layer"),
    zoomSlider: requiredElement<HTMLInputElement>("#zoom-slider"),
    zoomPercent: requiredElement<HTMLOutputElement>("#zoom-percent"),
    nodeCount: requiredElement<HTMLSpanElement>("#node-count"),
    titleInput: requiredElement<HTMLInputElement>("#node-title"),
    promptInput: requiredElement<HTMLTextAreaElement>("#node-prompt"),
    modelInput: requiredElement<HTMLSelectElement>("#node-model"),
    saveState: requiredElement<HTMLSpanElement>("#save-state"),
    resetButton: requiredElement<HTMLElement>("#reset"),
    jobLabel: requiredElement<HTMLSpanElement>("#job-label"),
    jobProgress: requiredElement<HTMLElement>("#job-progress"),
    generateButton: requiredElement<HTMLButtonElement>("#generate"),
  };

  readonly store = new CanvasStore<FlowNode, FlowLink>({ x: 80, y: 10, zoom: 0.9 });
  readonly camera = this.store.camera;
  readonly nodes = this.store.nodes;
  readonly links = this.store.links;
  readonly interaction = new CanvasInteractionController();
  readonly pointer = this.interaction.pointer;
  readonly selection = new CanvasSelectionController();
  readonly promptEditor = new PromptNodeController();
  readonly connection = new CanvasConnectionController();

  videoReferenceSwapSelection: { videoId: number; sourceId: number } | null = null;
  contextPosition: Point = { x: 0, y: 0 };
  projectId = localStorage.getItem("flow-project-id") ?? "default";
  backgroundMode: "dots" | "lines" | "blank" = "lines";
  colorTheme: "light" | "dark" =
    localStorage.getItem("flow-theme") === "light" ? "light" : "dark";

  constructor() {
    requiredElement<HTMLElement>(".brand").append(this.dom.saveState);
    document.body.dataset.theme = this.colorTheme;
  }
}

export function escapeRuntimeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
