import type { PromptAgentMode } from "../nodes/comic-types";
import { promptAgentGuidance } from "./prompt-agent-guidance";

type PromptAgentControlsOptions = {
  panel: HTMLElement;
  onComic: () => void;
  onModeChanged: (mode: PromptAgentMode) => void;
  isBusy: () => boolean;
  onMenuOpened?: () => void;
  onModeSelected?: (mode: PromptAgentMode) => void;
};

export class PromptAgentControls {
  mode: PromptAgentMode;
  kind: "image" | "video" = "image";
  complexity: "simple" | "detailed" = "simple";
  readonly modelSelect = document.createElement("select");
  readonly goalInput: HTMLTextAreaElement;
  private materialCount = 0;

  constructor(private readonly options: PromptAgentControlsOptions) {
    const stored = localStorage.getItem(
      "flow-prompt-agent-mode",
    ) as PromptAgentMode;
    this.mode = ["create", "general", "agnes", "voice"].includes(stored)
      ? stored
      : "create";
    this.modelSelect.hidden = true;
    this.modelSelect.innerHTML =
      '<option value="gpt-5.5" selected>gpt-5.5</option>';
    options.panel.append(this.modelSelect);
    this.goalInput = options.panel.querySelector<HTMLTextAreaElement>(
      ".agent-goal textarea",
    )!;
    this.bindEvents();
    queueMicrotask(() => this.setMode(this.mode));
  }

  setMode(mode: PromptAgentMode) {
    this.mode = mode;
    localStorage.setItem("flow-prompt-agent-mode", mode);
    const panel = this.options.panel;
    panel.querySelector<HTMLElement>("[data-agent-mode-trigger] b")!.textContent =
      "模式";
    panel
      .querySelectorAll<HTMLButtonElement>("[data-agent-mode]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.agentMode === mode),
      );
    panel.querySelector<HTMLElement>(".inspiration-mode")!.classList.remove("open");
    panel
      .querySelector<HTMLElement>(".inspiration-strategy")!
      .classList.remove("open");
    panel
      .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")!
      .setAttribute("aria-expanded", "false");
    panel.classList.remove("prompt-result-open");
    panel.querySelector<HTMLElement>("article")!.hidden = true;
    const promptOnly = mode === "general" || mode === "agnes";
    this.refreshGuidance();
    panel
      .querySelector<HTMLButtonElement>(".agent-submit")!
      .setAttribute(
        "aria-label",
        mode === "voice"
          ? "生成音色配置"
          : promptOnly
            ? "生成提示词"
            : "开始创作",
      );
    panel.classList.toggle("prompt-only", mode !== "create");
    this.options.onModeChanged(mode);
  }

  setMaterialCount(count: number) {
    this.materialCount = count;
    this.refreshGuidance();
  }

  guidance() { return promptAgentGuidance(this.mode, this.materialCount); }

  private refreshGuidance() {
    this.goalInput.placeholder = this.guidance().placeholder;
  }

  private bindEvents() {
    const panel = this.options.panel;
    panel
      .querySelector("[data-agent-mode-trigger]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        const control = panel.querySelector<HTMLElement>(".inspiration-mode")!;
        const open = control.classList.toggle("open");
        panel
          .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")!
          .setAttribute("aria-expanded", String(open));
        if (open) this.options.onMenuOpened?.();
      });
    panel
      .querySelectorAll<HTMLButtonElement>("[data-agent-mode]")
      .forEach((button) =>
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.setMode(button.dataset.agentMode as PromptAgentMode);
          this.options.onModeSelected?.(button.dataset.agentMode as PromptAgentMode);
        }),
      );
    panel
      .querySelector<HTMLButtonElement>("[data-agent-prompt-menu]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        const submenu = panel.querySelector<HTMLElement>(
          ".inspiration-strategy",
        )!;
        const open = submenu.classList.toggle("open");
        panel
          .querySelector<HTMLButtonElement>("[data-agent-prompt-menu]")!
          .setAttribute("aria-expanded", String(open));
      });
    panel
      .querySelector<HTMLButtonElement>("[data-agent-comic]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        this.options.onComic();
      });
    document.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement | null)?.closest(".inspiration-mode")) {
        panel.querySelector<HTMLElement>(".inspiration-mode")?.classList.remove("open");
        panel
          .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")
          ?.setAttribute("aria-expanded", "false");
      }
    });
    this.goalInput.addEventListener("input", () => this.resizeGoal());
    this.goalInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (this.options.isBusy() || this.goalInput.disabled) return;
      panel.querySelector<HTMLButtonElement>(".agent-submit")!.click();
    });
    panel
      .querySelectorAll<HTMLButtonElement>("[data-agent-kind]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          this.kind = button.dataset.agentKind as "image" | "video";
          panel
            .querySelectorAll("[data-agent-kind]")
            .forEach((item) => item.classList.toggle("active", item === button));
        }),
      );
    panel
      .querySelectorAll<HTMLButtonElement>("[data-agent-complexity]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          this.complexity = button.dataset.agentComplexity as
            | "simple"
            | "detailed";
          panel
            .querySelectorAll("[data-agent-complexity]")
            .forEach((item) => item.classList.toggle("active", item === button));
          panel.querySelector<HTMLElement>(".agent-submit b")!.textContent =
            this.complexity === "simple"
              ? "生成简洁提示词"
              : "生成详细提示词";
        }),
      );
  }

  private resizeGoal() {
    this.goalInput.style.height = "38px";
    const height = Math.min(
      58,
      Math.max(38, this.goalInput.scrollHeight),
    );
    this.goalInput.style.height = `${height}px`;
    this.options.panel.classList.toggle("has-wrapped-goal", height > 40);
  }
}
