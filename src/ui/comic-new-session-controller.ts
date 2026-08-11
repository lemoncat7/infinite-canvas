import type { ComicSessionState } from "../services/comic-session-state";

export class ComicNewSessionController {
  constructor(private readonly options: {
    studio: HTMLElement;
    state: ComicSessionState;
    closeMobilePanel: () => void;
    resetConversation: () => void;
    renderLabelState: () => void;
    notify: (message: string, tone: "warning" | "success") => void;
  }) {}

  start() {
    const { studio, state } = this.options;
    if (state.submitting) {
      this.options.notify("请等待当前构思完成后再开始新会话", "warning");
      return;
    }
    this.options.closeMobilePanel();
    studio.querySelector<HTMLElement>("[data-comic-label-menu]")?.classList.remove("open");
    state.originalIdea = "";
    state.linkedLabelId = 0;
    this.options.resetConversation();
    this.options.renderLabelState();
    studio.querySelectorAll(".comic-message:not(.comic-welcome)").forEach((message) => message.remove());
    studio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
    const field = studio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!;
    field.value = "";
    studio.querySelector<HTMLOutputElement>("[data-comic-status]")!.classList.remove("visible");
    field.focus();
    this.options.notify("已开始新的漫剧会话", "success");
  }
}
