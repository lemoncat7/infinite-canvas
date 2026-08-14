import type { FlowLink, FlowNode } from "./node-types";
import { bindNodeConfigPanel } from "../ui/node-editor";
import {
  exchangeImageReferenceOrder,
  orderedImageReferences,
  rewriteImageReferenceNumbers,
  synchronizeImageReferenceMentions,
} from "./ordered-image-references";

interface ImageNodePanelOptions {
  element: HTMLElement;
  nodeId: number;
  liveNode: () => FlowNode | undefined;
  nodes: FlowNode[];
  links: FlowLink[];
  scheduleSave: () => void;
  setEditingState: () => void;
  draw: () => void;
  generate: (node: FlowNode) => void | Promise<void>;
  selectNode: (id: number) => void;
  beginImageUpload: (nodeId: number) => void;
  beginImageLibrary: (nodeId: number) => void | Promise<void>;
  commitHistory: () => void;
  notify: (message: string, type: "info" | "success", detail?: string) => void;
  escapeHtml: (value: string) => string;
}

export function bindImageNodePanel(options: ImageNodePanelOptions) {
  const {
    element,
    nodeId,
    liveNode,
    nodes,
    links,
    scheduleSave,
    setEditingState,
    draw,
    generate,
    selectNode,
    beginImageUpload,
    beginImageLibrary,
    commitHistory,
    notify,
    escapeHtml,
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
  const description = imagePanel.querySelector<HTMLTextAreaElement>(
      '[data-image-field="description"]',
    )!,
    mentionMenu = imagePanel.querySelector<HTMLElement>(".image-mention-menu")!,
    mentionList = mentionMenu.querySelector<HTMLElement>("[data-image-mention-list]")!;
  let mentionStart = -1,
    activeMention = 0,
    selectedReferenceId = 0;
  const closeMentions = () => {
    mentionMenu.hidden = true;
    mentionStart = -1;
    activeMention = 0;
  };
  const linkedReferences = () => orderedImageReferences(nodeId, nodes, links);
  const currentReferences = () => {
    const offset = liveNode()?.mediaUrl ? 1 : 0;
    return linkedReferences().map((item) => ({ ...item, order: item.order + offset }));
  };
  const renderMentions = () => {
    const caret = description.selectionStart ?? description.value.length,
      match = description.value.slice(0, caret).match(/@([^@\n]*)$/);
    if (!match) return closeMentions();
    const query = match[1].trim().toLowerCase(),
      references = currentReferences().filter(({ source, order }) =>
        `${source.title} 图${order}`.toLowerCase().includes(query),
      );
    mentionStart = caret - match[0].length;
    activeMention = Math.min(activeMention, Math.max(0, references.length - 1));
    mentionList.innerHTML = references.length
      ? references.map(({ source, order }, index) =>
          `<button type="button" class="${index === activeMention ? "active" : ""}" data-image-mention-source="${source.id}"><span>${source.mediaUrl ? `<img src="${escapeHtml(source.mediaUrl)}" alt="">` : "等待"}</span><b>图${order}</b><small>${escapeHtml(source.title || "未命名素材")}</small></button>`,
        ).join("")
      : "<p>没有匹配的连接素材</p>";
    mentionMenu.hidden = false;
  };
  const insertMention = (sourceId: number) => {
    const reference = currentReferences().find((item) => item.source.id === sourceId);
    if (!reference || mentionStart < 0) return;
    const caret = description.selectionStart ?? description.value.length,
      token = `图${reference.order}「${reference.source.title || "未命名素材"}」`,
      suffix = description.value.slice(caret),
      spacer = suffix.startsWith(" ") || suffix.startsWith("\n") || !suffix ? "" : " ";
    description.value = `${description.value.slice(0, mentionStart)}${token}${spacer}${suffix}`;
    const current = liveNode();
    if (current) {
      current.imageReferenceMentions = [
        ...(current.imageReferenceMentions ?? []).filter(
          (item) => item.sourceId !== reference.source.id,
        ),
        { sourceId: reference.source.id, label: reference.source.title || "未命名素材" },
      ];
    }
    const nextCaret = mentionStart + token.length + spacer.length;
    description.setSelectionRange(nextCaret, nextCaret);
    description.dispatchEvent(new Event("input", { bubbles: true }));
    closeMentions();
    description.focus();
  };
  description.addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      current.body = (event.target as HTMLTextAreaElement).value;
      setEditingState();
      scheduleSave();
      draw();
      renderMentions();
    });
  description.addEventListener("keydown", (event) => {
    if (mentionMenu.hidden) return;
    const buttons = [...mentionList.querySelectorAll<HTMLButtonElement>("button")];
    if (event.key === "Escape") return closeMentions();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activeMention = buttons.length
        ? (activeMention + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        : 0;
      renderMentions();
    } else if (event.key === "Enter" && buttons.length) {
      event.preventDefault();
      insertMention(Number(buttons[activeMention].dataset.imageMentionSource));
    }
  });
  mentionList.addEventListener("pointerdown", (event) => event.preventDefault());
  mentionList.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-image-mention-source]",
    );
    if (button) insertMention(Number(button.dataset.imageMentionSource));
  });
  imagePanel
    .querySelector("[data-image-reference-list]")!
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-image-reference-source]",
      );
      if (!button) return;
      const sourceId = Number(button.dataset.imageReferenceSource);
      if (!selectedReferenceId) {
        selectedReferenceId = sourceId;
        button.classList.add("swap-selected");
        notify("已选择一张参考素材", "info", "再点击另一张即可交换图号和实际发送顺序。");
        return;
      }
      if (selectedReferenceId === sourceId) {
        selectedReferenceId = 0;
        button.classList.remove("swap-selected");
        return;
      }
      const current = liveNode(), before = currentReferences(), linkedBefore = linkedReferences();
      if (!current || !exchangeImageReferenceOrder(linkedBefore, selectedReferenceId, sourceId)) return;
      const after = currentReferences();
      current.body = rewriteImageReferenceNumbers(current.body, before, after);
      const synchronized = synchronizeImageReferenceMentions(
        current.body,
        current.imageReferenceMentions ?? [],
        after,
      );
      current.body = synchronized.prompt;
      current.imageReferenceMentions = synchronized.mentions;
      description.value = current.body;
      selectedReferenceId = 0;
      scheduleSave();
      commitHistory();
      notify("参考素材顺序已交换", "success", "提示词图号与接口发送顺序已同步更新。");
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

interface ClearImageActionOptions {
  element: HTMLElement;
  allNodes: FlowNode[];
  confirm: () => Promise<boolean>;
  removeCachedImage: (url: string) => void;
  normalizePrompt: (value: string) => string;
  selectNode: (id: number) => void;
  scheduleSave: () => void;
  draw: () => void;
  notify: (message: string) => void;
}

export function bindClearImageAction(options: ClearImageActionOptions) {
  const button = options.element.querySelector<HTMLButtonElement>(
    '[data-action="clear-image"]',
  )!;
  const clear = async (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = options.allNodes.find(
      (item) => item.id === Number(options.element.dataset.id),
    );
    if (
      !current?.mediaUrl ||
      current.status === "queued" ||
      current.status === "running" ||
      !(await options.confirm())
    )
      return;
    const latest = options.allNodes.find((item) => item.id === current.id);
    if (
      !latest?.mediaUrl ||
      latest.status === "queued" ||
      latest.status === "running"
    )
      return;
    options.removeCachedImage(latest.mediaUrl);
    if (!latest.corePrompt)
      latest.body = options.normalizePrompt(
        latest.generationPrompt || latest.body,
      );
    delete latest.mediaUrl;
    delete latest.jobId;
    latest.status = "idle";
    latest.progress = 0;
    latest.agentAuto = false;
    options.selectNode(latest.id);
    options.scheduleSave();
    options.draw();
    options.notify("图片已清除，原提示词与当前描述已保留");
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("pointerup", clear);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0) void clear(event);
  });
}
