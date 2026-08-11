import type { FlowNode, GenerationCapabilities } from "./node-types";
import { bindNodeConfigPanel } from "../ui/node-editor";

interface VideoNodePanelOptions {
  videoPanel: HTMLElement;
  liveNode: () => FlowNode | undefined;
  generationCapabilities: GenerationCapabilities;
  decodePromptClipboardText: (value: string) => string;
  scheduleSave: () => void;
  draw: () => void;
  generate: (node: FlowNode) => void | Promise<void>;
  selectNode: (id: number) => void;
}

export function bindVideoNodePanel(options: VideoNodePanelOptions) {
  const {
    videoPanel,
    liveNode,
    generationCapabilities,
    decodePromptClipboardText,
    scheduleSave,
    draw,
    generate,
    selectNode,
  } = options;
  bindNodeConfigPanel(videoPanel);
  videoPanel
    .querySelector<HTMLTextAreaElement>("[data-video-description]")!
    .addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      const field = event.target as HTMLTextAreaElement,
        caret = field.selectionStart ?? field.value.length,
        decoded = decodePromptClipboardText(field.value);
      if (decoded !== field.value) {
        const nextCaret = decodePromptClipboardText(
          field.value.slice(0, caret),
        ).length;
        field.value = decoded;
        field.setSelectionRange(nextCaret, nextCaret);
      }
      current.body = field.value;
      scheduleSave();
      draw();
    });
  videoPanel
    .querySelector<HTMLTextAreaElement>("[data-video-description]")!
    .addEventListener("paste", (event) => {
      const raw = event.clipboardData?.getData("text/plain") || "",
        decoded = decodePromptClipboardText(raw);
      if (decoded === raw) return;
      event.preventDefault();
      const field = event.currentTarget as HTMLTextAreaElement,
        start = field.selectionStart ?? field.value.length,
        end = field.selectionEnd ?? start;
      field.setRangeText(decoded, start, end, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  videoPanel
    .querySelector<HTMLInputElement>("[data-video-model]")!
    .addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      current.model = (event.target as HTMLInputElement).value;
      if (
        !current.model.startsWith("agnes-") &&
        current.videoSettings?.referenceMode === "keyframes"
      )
        current.videoSettings.referenceMode = "references";
      scheduleSave();
      draw();
    });
  videoPanel
    .querySelectorAll<HTMLButtonElement>("[data-video-model-option]")
    .forEach((option) =>
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (option.disabled) return;
        const input =
          videoPanel.querySelector<HTMLInputElement>("[data-video-model]")!;
        input.value = option.dataset.videoModelOption!;
        input.dispatchEvent(new Event("input"));
        videoPanel.querySelector<HTMLDetailsElement>(
          ".video-model-picker",
        )!.open = false;
        draw();
      }),
    );
  videoPanel
    .querySelectorAll<HTMLButtonElement>("[data-seconds-step]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const currentNode = liveNode();
        if (!currentNode) return;
        const current = Number(currentNode.videoSettings?.seconds ?? 5),
          limits = generationCapabilities.video?.seconds ?? { min: 1, max: 18 };
        const seconds = Math.min(
          limits.max,
          Math.max(limits.min, current + Number(button.dataset.secondsStep)),
        );
        currentNode.videoSettings = {
          resolution: "720p",
          aspectRatio: "16:9",
          ...(currentNode.videoSettings ?? {}),
          seconds: String(seconds),
        };
        scheduleSave();
        draw();
      }),
    );
  videoPanel
    .querySelector<HTMLInputElement>("[data-video-seed]")!
    .addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      const raw = (event.target as HTMLInputElement).value.trim(),
        seed = Number(raw);
      current.videoSettings = {
        seconds: "5",
        resolution: "720p",
        aspectRatio: "16:9",
        referenceMode: "references",
        ...(current.videoSettings || {}),
      };
      if (raw && Number.isSafeInteger(seed) && seed >= 0)
        current.videoSettings.seed = seed;
      else delete current.videoSettings.seed;
      scheduleSave();
    });
  videoPanel
    .querySelectorAll<HTMLButtonElement>("[data-video-setting]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const current = liveNode();
        if (!current || button.disabled) return;
        const key = button.dataset.videoSetting as
          "seconds" | "resolution" | "aspectRatio" | "referenceMode";
        if (
          key === "referenceMode" &&
          button.dataset.value === "keyframes" &&
          !current.model?.startsWith("agnes-")
        )
          return;
        current.videoSettings = {
          seconds: "5",
          resolution: "720p",
          aspectRatio: "16:9",
          referenceMode: "references",
          ...(current.videoSettings ?? {}),
          [key]: button.dataset.value!,
        };
        scheduleSave();
        draw();
      }),
    );
  videoPanel
    .querySelector("[data-video-generate]")!
    .addEventListener("click", () => {
      const current = liveNode();
      if (!current) return;
      const description = videoPanel.querySelector<HTMLTextAreaElement>(
        "[data-video-description]",
      )!.value;
      if (current.body !== description) {
        current.body = description;
        scheduleSave();
      }
      selectNode(current.id);
      void generate(current);
    });
  
}

