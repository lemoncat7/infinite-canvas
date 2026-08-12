import type { FlowNode } from "./node-types";
import { LABEL_TEXT_LAYOUT, labelBodyMetrics } from "./label-text-layout";

export interface NodeViewFlags {
  selected: boolean;
  batchSelected: boolean;
  agentReference: boolean;
  locked: boolean;
  workflowWaiting: boolean;
  onscreen: boolean;
  editing: boolean;
  colorTheme: string;
  videoDependency: string;
  swapSourceId: number;
}

export function normalizeNodeViewSize(node: FlowNode) {
  if (!Number.isFinite(node.width) || node.width < 1) node.width = 280;
  if (!Number.isFinite(node.height) || node.height < 1) node.height = 220;
  if (
    (node.kind === "video" && node.role !== "result") ||
    node.kind === "voice" ||
    node.kind === "tts"
  ) {
    node.width = 290;
    node.height = 225;
  }
}

export function styleNodeEditor(
  element: HTMLElement,
  node: FlowNode,
  flags: NodeViewFlags,
) {
  const className = `flow-node pixi-card-editor kind-${node.kind}${node.role === "result" || node.kind === "audio" ? " node-result" : " node-generator"}${flags.selected ? " selected" : ""}${flags.editing ? " prompt-inline-editing" : ""}${flags.batchSelected ? " batch-selected" : ""}${flags.agentReference ? " agent-reference" : ""}${flags.locked ? " generating" : ""}${flags.workflowWaiting ? " workflow-waiting" : ""}`;
  if (element.className !== className) element.className = className;
  element.style.transform = `translate(${node.x}px, ${node.y}px)`;
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
  element.style.setProperty("--accent", node.accent);
  element.style.setProperty("--font-scale", String(node.fontScale ?? 1));
  const labelMetrics = labelBodyMetrics(node.width, node.height, node.fontScale);
  element.style.setProperty("--label-x", `${LABEL_TEXT_LAYOUT.horizontalPadding}px`);
  element.style.setProperty("--label-title-top", `${LABEL_TEXT_LAYOUT.titleTop}px`);
  element.style.setProperty("--label-title-size", `${labelMetrics.titleFontSize}px`);
  element.style.setProperty("--label-title-line", `${labelMetrics.titleLineHeight}px`);
  element.style.setProperty("--label-body-top", `${LABEL_TEXT_LAYOUT.bodyTop}px`);
  element.style.setProperty("--label-body-bottom", `${LABEL_TEXT_LAYOUT.bodyBottom}px`);
  element.style.setProperty("--label-body-size", `${labelMetrics.fontSize}px`);
  element.style.setProperty("--label-body-line", `${labelMetrics.lineHeight}px`);
  if (node.kind === "audio")
    element.style.setProperty("background", "#111820", "important");
  else element.style.removeProperty("background");
}

export function nodeDomState(node: FlowNode, flags: NodeViewFlags): unknown[] {
  return [
    node.kind,
    node.role,
    node.width,
    node.height,
    node.title,
    node.body,
    node.originalPrompt,
    node.generationPrompt,
    node.accent,
    node.model,
    node.jobId,
    node.progress,
    node.status,
    node.mediaUrl,
    node.fontScale,
    node.labelScroll,
    node.agentAuto,
    node.imageSettings?.size,
    node.imageSettings?.quality,
    node.imageSettings?.background,
    node.videoSettings?.seconds,
    node.videoSettings?.resolution,
    node.videoSettings?.aspectRatio,
    node.videoSettings?.referenceMode,
    node.voiceSettings?.providerId,
    node.voiceSettings?.voiceId,
    node.voiceSettings?.language,
    node.voiceSettings?.defaultSpeed,
    node.voiceSettings?.pitch,
    node.voiceSettings?.volume,
    node.voiceSettings?.roleName,
    node.voiceSettings?.tone,
    node.ttsSettings?.emotion,
    node.ttsSettings?.speed,
    node.ttsSettings?.format,
    node.ttsSettings?.duration,
    flags.selected,
    flags.batchSelected,
    flags.agentReference,
    flags.locked,
    flags.workflowWaiting,
    flags.onscreen,
    flags.editing,
    flags.colorTheme,
    flags.videoDependency,
    flags.swapSourceId,
  ];
}

export function nodeDomStateEquals(previous: unknown[] | undefined, next: unknown[]) {
  return (
    previous?.length === next.length &&
    next.every((value, index) => value === previous[index])
  );
}

export function syncBasicNodeContent(
  element: HTMLElement,
  node: FlowNode,
  editing: boolean,
  defaultCopy: (kind: FlowNode["kind"]) => string,
) {
  element.querySelectorAll<HTMLElement>(".node-port").forEach((port) => {
    port.hidden = node.kind === "video" && node.role === "result";
  });
  const copy = element.querySelector<HTMLElement>(".node-copy")!;
  if (!editing) copy.textContent = node.body || defaultCopy(node.kind);
  const heading = element.querySelector<HTMLElement>(".node-label-heading")!;
  heading.hidden = node.kind !== "prompt";
  if (node.kind === "prompt" && document.activeElement !== heading)
    heading.textContent = node.title || "未命名标签";
  element.querySelector<HTMLElement>(".node-kind")!.textContent =
    node.kind === "prompt"
      ? "LABEL"
      : node.kind === "note"
        ? "NOTE"
        : node.kind === "video"
          ? "VIDEO"
          : node.kind === "voice"
            ? "VOICE"
            : node.kind === "tts"
              ? "TTS"
              : node.kind === "audio"
                ? "AUDIO"
                : "IMAGE";
}
