import type { FlowNode, Point } from "./node-types";

export interface DomNodeDrag {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  element: HTMLElement;
  moved: boolean;
  agentSelect?: boolean;
  groupInitial?: Map<number, Point>;
  nativeControl?: boolean;
}

interface NodePointerOptions {
  element: HTMLElement;
  liveNode: () => FlowNode | undefined;
  allNodes: FlowNode[];
  batchIds: Set<number>;
  isMultiSelectMode: () => boolean;
  getDrag: () => DomNodeDrag | null;
  setDrag: (drag: DomNodeDrag) => void;
  isAgentSelecting: () => boolean;
  isAgentCreateMode: () => boolean;
  isReleaseSuppressed: () => boolean;
  selectNode: (id: number) => void;
  clearSelection: () => void;
  draw: () => void;
  editPrompt: (node: FlowNode, element: HTMLElement) => void;
  previewMedia: (node: FlowNode) => void;
}

export function bindNodePointerInteraction(options: NodePointerOptions) {
  const { element, liveNode } = options;
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || options.getDrag()) return;
    const current = liveNode();
    if (!current) return;
    const target = event.target as HTMLElement;
    const makeGroup = () =>
      options.batchIds.has(current.id)
        ? new Map(
            options.allNodes
              .filter((item) => options.batchIds.has(item.id))
              .map((item) => [item.id, { x: item.x, y: item.y }]),
          )
        : undefined;
    if (target.closest("audio") && current.kind === "audio") {
      options.setDrag({
        id: current.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initialX: current.x,
        initialY: current.y,
        element,
        moved: false,
        groupInitial: makeGroup(),
        nativeControl: true,
      });
      return;
    }
    if (
      target.closest(
        "button,input,textarea,select,audio,details,.node-port,.image-config-panel,.video-config-panel,.video-result-prompt,.voice-config-panel,.tts-config-panel,.node-floating-tools,.node-label-heading",
      ) ||
      target.closest('.node-copy[contenteditable="true"]')
    )
      return;
    if (options.isAgentSelecting() && options.isAgentCreateMode()) {
      event.preventDefault();
      event.stopPropagation();
      element.setPointerCapture(event.pointerId);
      options.setDrag({
        id: current.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initialX: current.x,
        initialY: current.y,
        element,
        moved: false,
        agentSelect: true,
      });
      element.classList.add("dragging");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (
      (current.status === "queued" || current.status === "running") &&
      !options.batchIds.has(current.id)
    ) {
      options.selectNode(current.id);
      options.draw();
      return;
    }
    if (!options.isMultiSelectMode() && !options.batchIds.has(current.id))
      options.selectNode(current.id);
    element.setPointerCapture(event.pointerId);
    options.setDrag({
      id: current.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: current.x,
      initialY: current.y,
      element,
      moved: false,
      groupInitial: makeGroup(),
    });
    element.classList.add("dragging");
    options.draw();
  });

  element.addEventListener("dblclick", (event) => {
    if (options.isReleaseSuppressed()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (event.target as HTMLElement).closest(
        ".image-config-panel,.video-config-panel,.node-floating-tools,.node-port",
      )
    )
      return;
    const current = liveNode();
    if (!current) return;
    if (current.kind === "audio") {
      event.preventDefault();
      event.stopPropagation();
      const audio = element.querySelector<HTMLAudioElement>(
        ".audio-result-panel audio",
      );
      if (!current.mediaUrl || !audio) return;
      options.selectNode(current.id);
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    if (current.kind === "prompt") {
      event.preventDefault();
      event.stopPropagation();
      options.selectNode(current.id);
      options.editPrompt(current, element);
      return;
    }
    if (
      (current.kind !== "image" && current.kind !== "video") ||
      !current.mediaUrl
    )
      return;
    const rect = element
      .querySelector<HTMLElement>(".node-media")!
      .getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    options.selectNode(current.id);
    options.previewMedia(current);
  });
  element.addEventListener("dragstart", (event) => event.preventDefault());
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

interface NodeHeadingOptions {
  element: HTMLElement;
  liveNode: () => FlowNode | undefined;
  setEditingState: () => void;
  scheduleSave: () => void;
  draw: () => void;
}

export function bindNodeLabelHeading(options: NodeHeadingOptions) {
  const heading = options.element.querySelector<HTMLElement>(
    ".node-label-heading",
  )!;
  heading.addEventListener("dblclick", (event) => {
    if (options.liveNode()?.kind !== "prompt") return;
    event.preventDefault();
    event.stopPropagation();
    heading.contentEditable = "true";
    heading.classList.add("editing");
    heading.focus();
    const range = document.createRange();
    range.selectNodeContents(heading);
    const browserSelection = getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
  });
  heading.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    heading.blur();
  });
  heading.addEventListener("input", () => {
    const current = options.liveNode();
    if (!current) return;
    current.title = heading.innerText;
    options.setEditingState();
  });
  heading.addEventListener("blur", () => {
    if (!heading.isContentEditable) return;
    const current = options.liveNode();
    if (!current) return;
    current.title = heading.innerText.trim() || "未命名标签";
    heading.contentEditable = "false";
    heading.classList.remove("editing");
    options.scheduleSave();
    options.draw();
  });
}

export function bindNodePorts(
  element: HTMLElement,
  nodeId: number,
  beginConnection: (nodeId: number, point: Point) => void,
) {
  element.querySelectorAll<HTMLElement>(".node-port").forEach((port) => {
    const output = port.dataset.side === "right";
    port.dataset.label = output ? "输出" : "输入";
    port.title = output
      ? "输出：拖动到其他卡片的输入端"
      : "输入：接收其他卡片的输出";
    port.setAttribute("aria-label", output ? "输出端点" : "输入端点");
    port.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (output) beginConnection(nodeId, { x: event.clientX, y: event.clientY });
    });
  });
}

interface NodeToolbarOptions {
  element: HTMLElement;
  liveNode: () => FlowNode | undefined;
  selectNode: (id: number) => void;
  showInfo: (node: FlowNode) => void;
  editPrompt: (node: FlowNode, element: HTMLElement) => void;
  focusEditor: () => void;
  scheduleSave: () => void;
  draw: () => void;
  generate: (node: FlowNode) => void | Promise<void>;
  previewMedia: (node: FlowNode) => void;
  downloadMedia: (node: FlowNode) => void | Promise<void>;
  deleteNode: (node: FlowNode) => void;
}

export function bindNodeToolbarActions(options: NodeToolbarOptions) {
  const { element, liveNode } = options;
  const on = (action: string, run: (node: FlowNode) => void) =>
    element
      .querySelector(`[data-action="${action}"]`)!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        const node = liveNode();
        if (node) run(node);
      });
  on("info", options.showInfo);
  on("edit", (node) => {
    options.selectNode(node.id);
    if (node.kind === "prompt") options.editPrompt(node, element);
    else options.focusEditor();
  });
  on("zoom-in", (node) => {
    node.fontScale = Math.min(2, (node.fontScale ?? 1) + 0.1);
    options.scheduleSave();
    options.draw();
  });
  on("zoom-out", (node) => {
    node.fontScale = Math.max(0.7, (node.fontScale ?? 1) - 0.1);
    options.scheduleSave();
    options.draw();
  });
  on("generate", (node) => {
    options.selectNode(node.id);
    void options.generate(node);
  });
  on("preview", (node) => {
    if (
      node.mediaUrl &&
      (node.kind === "image" || node.kind === "video")
    )
      options.previewMedia(node);
  });
  on("download", (node) => {
    if (node.mediaUrl) void options.downloadMedia(node);
  });
  on("delete", options.deleteNode);
}
