import type { FlowNode } from "./node-types";

interface ImageNodeSyncOptions {
  element: HTMLElement;
  node: FlowNode;
  selected: boolean;
  locked: boolean;
  normalizePrompt: (value?: string) => string;
  displayModelName: (value?: string) => string;
  renderSubmit: (button: HTMLButtonElement, locked: boolean, disabled?: boolean) => void;
}

export function syncImageNodePanel(options: ImageNodeSyncOptions) {
  const {
    element,
    node,
    selected,
    locked,
    normalizePrompt,
    displayModelName,
    renderSubmit,
  } = options;
  element.querySelector<HTMLElement>(".node-info-popover")!.textContent =
    `${node.kind === "prompt" ? "标签" : node.kind === "image" ? "图片" : node.kind === "video" ? "视频" : node.kind === "voice" ? "语音配置" : node.kind === "tts" ? "TTS 文本" : node.kind === "audio" ? "音频" : "便签"}节点 · ${node.body.length} 字 · ${Math.round((node.fontScale ?? 1) * 100)}%`;
  const imagePanel = element.querySelector<HTMLElement>(
    ".image-config-panel",
  )!;
  const imagePanelOpen = node.kind === "image" && selected;
  imagePanel.classList.toggle("open", imagePanelOpen);
  if (!imagePanelOpen)
    imagePanel
      .querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((details) => (details.open = false));
  const videoPanel = element.querySelector<HTMLElement>(
    ".video-config-panel",
  )!;
  const videoPanelOpen =
    node.kind === "video" && node.role !== "result" && selected;
  videoPanel.classList.toggle("open", videoPanelOpen);
  if (!videoPanelOpen)
    videoPanel
      .querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((details) => (details.open = false));
  const videoResultPrompt = element.querySelector<HTMLElement>(
    ".video-result-prompt",
  )!;
  videoResultPrompt.classList.toggle(
    "open",
    node.kind === "video" && node.role === "result" && selected,
  );
  videoResultPrompt.querySelector<HTMLElement>("p")!.textContent =
    node.generationPrompt || "暂无生成提示词";
  if (node.kind === "image") {
    if (node.model === "z-image-turbo" || node.model === "flux1-kontext-dev")
      node.model = "gpt-image-2";
    const model = imagePanel.querySelector<HTMLSelectElement>(
        '[data-image-field="model"]',
      )!,
      description = imagePanel.querySelector<HTMLTextAreaElement>(
        '[data-image-field="description"]',
      )!;
    if (document.activeElement !== model)
      model.value = node.model ?? "gpt-image-2";
    imagePanel.querySelector<HTMLElement>(
      "[data-image-model-label]",
    )!.textContent = displayModelName(node.model ?? "gpt-image-2");
    description.placeholder = node.mediaUrl
      ? "描述你想如何修改这张图片"
      : "描述要生成的图片内容";
    if (document.activeElement !== description) description.value = node.body;
    const originalPrompt = imagePanel.querySelector<HTMLElement>(
        ".image-original-prompt",
      )!,
      originalPromptValue = normalizePrompt(
        node.originalPrompt || node.generationPrompt,
      );
    originalPrompt.classList.toggle(
      "visible",
      Boolean(originalPromptValue || node.mediaUrl),
    );
    originalPrompt.querySelector<HTMLElement>("p")!.textContent =
      originalPromptValue || "导入图片，无生成提示词";
    for (const key of ["size", "quality", "background"] as const) {
      const input = imagePanel.querySelector<HTMLSelectElement>(
        `[data-image-field="${key}"]`,
      )!;
      if (document.activeElement !== input)
        input.value = node.imageSettings?.[key] ?? "auto";
    }
    imagePanel
      .querySelectorAll<HTMLElement>("[data-image-setting]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          node.imageSettings?.[
            button.dataset.imageSetting as "size" | "quality" | "background"
          ] === button.dataset.value ||
            ((!node.imageSettings?.[
              button.dataset.imageSetting as "size" | "quality" | "background"
            ] ||
              node.imageSettings?.[
                button.dataset.imageSetting as
                  "size" | "quality" | "background"
              ] === "auto") &&
              button.dataset.value === "auto"),
        ),
      );
    const sizeLabel =
      (
        {
          auto: "自动尺寸",
          "1024x1024": "1:1",
          "1344x1008": "4:3",
          "1008x1344": "3:4",
          "1536x1024": "3:2",
          "1024x1536": "2:3",
          "1536x864": "16:9",
          "864x1536": "9:16",
        } as Record<string, string>
      )[node.imageSettings?.size ?? "auto"] ?? node.imageSettings?.size;
    const qualityLabel =
      (
        {
          auto: "自动质量",
          high: "高质量",
          medium: "标准质量",
          low: "低质量",
        } as Record<string, string>
      )[node.imageSettings?.quality ?? "auto"] ?? node.imageSettings?.quality;
    imagePanel.querySelector<HTMLElement>(
      "[data-image-settings-label]",
    )!.textContent = `${qualityLabel} · ${sizeLabel}`;
    const generateButton = imagePanel.querySelector<HTMLButtonElement>(
      "[data-image-generate]",
    )!;
    renderSubmit(generateButton, locked);
    element
      .querySelectorAll<HTMLButtonElement>(
        "[data-image-upload],[data-image-library]",
      )
      .forEach((button) => {
        button.disabled = locked;
        button.title = locked ? "生成期间不可更换素材" : "";
      });
  }
  
}
