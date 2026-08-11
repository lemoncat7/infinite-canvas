import type { FlowLink, FlowNode } from "./node-types";

interface VideoNodeSyncOptions {
  element: HTMLElement;
  node: FlowNode;
  nodes: FlowNode[];
  links: FlowLink[];
  scheduleSave: () => void;
  displayModelName: (value?: string) => string;
  decodePrompt: (value: string) => string;
  canGenerate: (node: FlowNode) => boolean;
  renderSubmit: (button: HTMLButtonElement, locked: boolean, disabled?: boolean) => void;
  locked: boolean;
}

export function syncVideoNodePanel(options: VideoNodeSyncOptions) {
  const {
    element,
    node,
    nodes,
    links,
    scheduleSave,
    displayModelName,
    decodePrompt,
    canGenerate,
    renderSubmit,
    locked,
  } = options;
  const videoPanel = element.querySelector<HTMLElement>(
    ".video-config-panel",
  )!;
  if (node.kind === "video") {
    const supportsNativeKeyframes = node.model?.startsWith("agnes-") === true,
      imageInputCount = links.filter(
        (link) =>
          link.to === node.id &&
          nodes.find((item) => item.id === link.from)?.kind === "image",
      ).length;
    if (
      node.role !== "result" &&
      supportsNativeKeyframes &&
      imageInputCount > 1 &&
      node.videoSettings?.referenceMode !== "keyframes"
    ) {
      node.videoSettings = {
        ...(node.videoSettings || {}),
        referenceMode: "keyframes",
      };
      scheduleSave();
    } else if (
      node.role !== "result" &&
      (!supportsNativeKeyframes || imageInputCount < 2) &&
      node.videoSettings?.referenceMode === "keyframes"
    ) {
      node.videoSettings.referenceMode = "references";
      scheduleSave();
    }
    const results = nodes.filter(
        (item) =>
          item.kind === "video" &&
          item.role === "result" &&
          item.sourceNodeId === node.id,
      ),
      queuedCount = results.filter((item) => item.status === "queued").length,
      runningCount = results.filter(
        (item) => item.status === "running",
      ).length,
      succeededCount = results.filter(
        (item) => item.status === "succeeded" && Boolean(item.mediaUrl),
      ).length;
    element.querySelector<HTMLElement>(
      ".video-generation-count",
    )!.textContent =
      node.role === "result"
        ? node.status === "queued"
          ? "任务排队中"
          : node.status === "running"
            ? Number(node.progress ?? 0) > 0
              ? `生成中 ${Math.round(node.progress ?? 0)}%`
              : node.model?.startsWith("agnes-")
                ? "云端处理中"
                : "生成中 · 等待进度"
            : node.status === "failed"
              ? "生成失败"
              : node.videoResult?.seconds || node.videoResult?.size
                ? `实际 ${node.videoResult.seconds ? `${node.videoResult.seconds}秒` : ""}${node.videoResult.seconds && node.videoResult.size ? " · " : ""}${node.videoResult.size || ""}`
                : "生成结果"
        : `排队 ${queuedCount} · 生成中 ${runningCount} · 已生成 ${succeededCount}`;
    element.querySelector<HTMLElement>(".video-result-model")!.textContent =
      displayModelName(node.model) || "未知模型";
    const description = videoPanel.querySelector<HTMLTextAreaElement>(
        "[data-video-description]",
      )!,
      cleanVideoDescription = decodePrompt(node.body);
    if (cleanVideoDescription !== node.body) {
      node.body = cleanVideoDescription;
      scheduleSave();
    }
    if (document.activeElement !== description) description.value = node.body;
    videoPanel.querySelector<HTMLInputElement>("[data-video-model]")!.value =
      node.model ?? "agnes-video-v2.0";
    videoPanel
      .querySelectorAll<HTMLButtonElement>("[data-video-model-option]")
      .forEach((option) =>
        option.classList.toggle(
          "active",
          option.dataset.videoModelOption ===
            (node.model ?? "agnes-video-v2.0"),
        ),
      );
    videoPanel.querySelector<HTMLElement>(
      ".video-model-picker summary b",
    )!.textContent = displayModelName(node.model ?? "agnes-video-v2.0");
    videoPanel.querySelector<HTMLOutputElement>(
      "[data-video-seconds]",
    )!.value = `${node.videoSettings?.seconds ?? "5"} 秒`;
    const seedField =
      videoPanel.querySelector<HTMLInputElement>("[data-video-seed]")!;
    if (document.activeElement !== seedField)
      seedField.value = Number.isSafeInteger(node.videoSettings?.seed)
        ? String(node.videoSettings!.seed)
        : "";
    videoPanel.querySelector<HTMLElement>(
      ".video-settings-picker summary b",
    )!.textContent =
      `${node.videoSettings?.seconds ?? "5"}秒 · ${node.videoSettings?.referenceMode === "keyframes" ? "连续帧" : "参考图"} · ${node.videoSettings?.resolution ?? "720p"} · ${node.videoSettings?.aspectRatio ?? "16:9"}`;
    videoPanel
      .querySelectorAll<HTMLButtonElement>("[data-video-setting]")
      .forEach((button) => {
        const key = button.dataset.videoSetting as
            "seconds" | "resolution" | "aspectRatio" | "referenceMode",
          value =
            key === "referenceMode"
              ? (node.videoSettings?.referenceMode ?? "references")
              : node.videoSettings?.[key],
          keyframes =
            key === "referenceMode" && button.dataset.value === "keyframes",
          references =
            key === "referenceMode" && button.dataset.value === "references",
          unsupported =
            (keyframes &&
              (!supportsNativeKeyframes || imageInputCount < 2)) ||
            (references && supportsNativeKeyframes && imageInputCount > 1);
        button.disabled = unsupported;
        button.title = unsupported
          ? keyframes
            ? "关键帧动画需要 Agnes 和至少两张有序图片"
            : "Agnes 官方接口不支持多图自由参考，请使用关键帧动画"
          : keyframes
            ? "Agnes 原生关键帧动画，严格按卡片中的图片编号排序"
            : "";
        button.classList.toggle("model-unavailable", unsupported);
        button.classList.toggle("active", value === button.dataset.value);
      });
    const button = videoPanel.querySelector<HTMLButtonElement>(
      "[data-video-generate]",
    )!;
    renderSubmit(button, locked, !canGenerate(node));
  }
  
}

