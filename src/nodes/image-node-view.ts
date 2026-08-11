import type { FlowNode } from "./node-types";
import { bindNodeConfigPanel } from "../ui/node-editor";

interface ImageNodePanelOptions {
  element: HTMLElement;
  nodeId: number;
  liveNode: () => FlowNode | undefined;
  scheduleSave: () => void;
  setEditingState: () => void;
  draw: () => void;
  generate: (node: FlowNode) => void | Promise<void>;
  selectNode: (id: number) => void;
  beginImageUpload: (nodeId: number) => void;
  beginImageLibrary: (nodeId: number) => void | Promise<void>;
}

export function bindImageNodePanel(options: ImageNodePanelOptions) {
  const {
    element,
    nodeId,
    liveNode,
    scheduleSave,
    setEditingState,
    draw,
    generate,
    selectNode,
    beginImageUpload,
    beginImageLibrary,
  } = options;
  const imagePanel = element.querySelector<HTMLElement>(".image-config-panel")!;
  bindNodeConfigPanel(imagePanel);
  imagePanel
    .querySelector<HTMLSelectElement>('[data-image-field="model"]')!
    .addEventListener("change", (event) => {
      const current = liveNode();
      if (!current) return;
      current.model = (event.target as HTMLSelectElement).value;
      scheduleSave();
    });
  imagePanel
    .querySelectorAll<HTMLButtonElement>("[data-image-model]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const select = imagePanel.querySelector<HTMLSelectElement>(
          '[data-image-field="model"]',
        )!;
        select.value = button.dataset.imageModel!;
        select.dispatchEvent(new Event("change"));
        button.blur();
        imagePanel.querySelector<HTMLDetailsElement>(
          ".image-model-picker",
        )!.open = false;
        draw();
      }),
    );
  imagePanel
    .querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!
    .addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      current.body = (event.target as HTMLTextAreaElement).value;
      setEditingState();
      scheduleSave();
      draw();
    });
  for (const key of ["size", "quality", "background"] as const)
    imagePanel
      .querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!
      .addEventListener("change", (event) => {
        const current = liveNode();
        if (!current) return;
        current.imageSettings = {
          ...(current.imageSettings ?? {}),
          [key]: (event.target as HTMLSelectElement).value,
        };
        scheduleSave();
      });
  imagePanel
    .querySelectorAll<HTMLButtonElement>("[data-image-setting]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentNode = liveNode();
        if (!currentNode) return;
        const key = button.dataset.imageSetting as
            "size" | "quality" | "background",
          current = currentNode.imageSettings?.[key] ?? "auto",
          value =
            key === "background" && current === "transparent"
              ? "auto"
              : button.dataset.value!;
        const select = imagePanel.querySelector<HTMLSelectElement>(
          `[data-image-field="${key}"]`,
        )!;
        select.value = value;
        select.dispatchEvent(new Event("change"));
        draw();
      }),
    );
  imagePanel
    .querySelector("[data-image-generate]")!
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = liveNode();
      if (!current) return;
      const description = imagePanel.querySelector<HTMLTextAreaElement>(
        '[data-image-field="description"]',
      )!.value;
      if (current.body !== description) {
        current.body = description;
        scheduleSave();
      }
      selectNode(current.id);
      void generate(current);
    });
  element
    .querySelector("[data-image-upload]")!
    .addEventListener("click", (event) => {
      event.stopPropagation();
      beginImageUpload(nodeId);
    });
  element
    .querySelector("[data-image-library]")!
    .addEventListener("click", (event) => {
      event.stopPropagation();
      void beginImageLibrary(nodeId);
    });
  
}

