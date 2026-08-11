import type { FlowNode } from "../nodes/node-types";

type NodeToolAction =
  | "info"
  | "edit"
  | "zoom-in"
  | "zoom-out"
  | "generate"
  | "preview"
  | "download"
  | "clear-image"
  | "delete";

const toolContent: Record<NodeToolAction, { label: string; icon: string }> = {
  info: { label: "信息", icon: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>' },
  edit: { label: "编辑", icon: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>' },
  "zoom-in": { label: "放大", icon: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M11 8v6"></path><path d="M8 11h6"></path>' },
  "zoom-out": { label: "缩小", icon: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M8 11h6"></path>' },
  generate: { label: "生成", icon: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"></path>' },
  preview: { label: "预览", icon: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>' },
  download: { label: "下载", icon: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>' },
  "clear-image": { label: "清除图片", icon: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m7 6 1 14h8l1-14"></path><path d="M10 10v6M14 10v6"></path>' },
  delete: { label: "删除", icon: '<path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' },
};

function nodeToolActions(node: FlowNode) {
  if (node.kind === "image")
    return new Set<NodeToolAction>([
      "info",
      ...(node.mediaUrl ? (["download", "clear-image"] as NodeToolAction[]) : []),
      "delete",
    ]);
  if (node.kind === "audio")
    return new Set<NodeToolAction>([
      "info",
      ...(node.mediaUrl ? (["download"] as NodeToolAction[]) : []),
      "delete",
    ]);
  if (node.kind === "video" || node.kind === "voice" || node.kind === "tts")
    return new Set<NodeToolAction>(["info", "delete"]);
  if (node.kind === "prompt")
    return new Set<NodeToolAction>(["info", "edit", "zoom-in", "zoom-out", "delete"]);
  return new Set<NodeToolAction>(["info", "edit", "delete"]);
}

export function renderNodeToolbar(
  element: HTMLElement,
  node: FlowNode,
  locked: boolean,
) {
  const visible = nodeToolActions(node);
  element
    .querySelectorAll<HTMLButtonElement>(".node-floating-tools [data-action]")
    .forEach((button) => {
      const action = button.dataset.action as NodeToolAction;
      button.hidden = !visible.has(action);
      button.disabled = action === "clear-image" && locked;
      const content = toolContent[action];
      if (content && button.dataset.toolRendered !== "true") {
        button.dataset.toolRendered = "true";
        button.innerHTML = `<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true">${content.icon}</svg><span>${content.label}</span></span>`;
        button.title = content.label;
      }
    });
}

export function renderComposerSubmit(
  button: HTMLButtonElement,
  running: boolean,
  disabled = false,
) {
  button.classList.add("node-composer-submit");
  button.disabled = running || disabled;
  button.classList.toggle("is-running", running);
  button.title = running ? "任务正在生成" : "开始生成";
  button.innerHTML = running
    ? '<i aria-hidden="true"></i><b>生成中</b>'
    : "<span>▶</span><b>生成</b>";
}

export function bindNodeConfigPanel(panel: HTMLElement) {
  panel.classList.add("node-config-panel");
  panel.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    panel
      .querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((details) => {
        if (!details.contains(target)) details.open = false;
      });
    event.stopPropagation();
  });
  for (const eventName of ["mousedown", "click", "wheel"] as const)
    panel.addEventListener(eventName, (event) => event.stopPropagation());
}
