import type { ComicSessionSnapshot } from "../services/comic";
import { ComicSessionState } from "../services/comic-session-state";

type ComicSessionRecoveryOptions = {
  studio: HTMLElement;
  state: ComicSessionState;
  ownerKey: () => string;
  setInteractionLocked: (locked: boolean) => void;
  renderBrief: () => void;
  renderPlan: NonNullable<(plan: ComicSessionSnapshot["plan"]) => void>;
  renderLabelState: () => void;
  showWarning: (message: string) => void;
};

export class ComicSessionRecoveryView {
  constructor(private readonly options: ComicSessionRecoveryOptions) {}

  clear() {
    const { studio, state } = this.options;
    state.clear(this.options.ownerKey());
    this.options.setInteractionLocked(false);
    this.options.renderBrief();
    this.options.renderLabelState();
    studio
      .querySelectorAll(".comic-message:not(.comic-welcome)")
      .forEach((message) => message.remove());
    studio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
    studio
      .querySelector<HTMLOutputElement>("[data-comic-status]")!
      .classList.remove("visible", "generating");
  }

  apply(snapshot: ComicSessionSnapshot) {
    const { studio, state } = this.options;
    state.restore(snapshot);
    if (state.plan) this.options.renderPlan(state.plan);
    this.options.renderBrief();
    const status = studio.querySelector<HTMLOutputElement>("[data-comic-status]")!;
    this.options.setInteractionLocked(state.submitting);
    if (state.submitting) {
      status.classList.add("visible", "generating");
      const amount = snapshot.generationReceivedBytes
        ? ` · 已接收 ${(Number(snapshot.generationReceivedBytes) / 1024).toFixed(1)} KB`
        : "";
      const progress = Number(snapshot.generationProgress) || 0;
      status.textContent = `${snapshot.generationStage || "正在生成完整剧本"} · ${progress}%${amount}`;
      return;
    }
    if (snapshot.generationStatus === "interrupted" || snapshot.generationStatus === "failed") {
      const baseMessage = snapshot.generationError || "上一次漫剧生成已中断，请重新生成";
      const message = snapshot.hasGenerationCheckpoint
        ? `${baseMessage} 再次点击生成将从已校验检查点继续。`
        : baseMessage;
      status.textContent = message;
      status.classList.add("visible");
      this.options.showWarning(message);
      return;
    }
    if (snapshot.generationStatus === "succeeded" && state.plan) {
      status.textContent = "完整剧本已恢复";
      status.classList.add("visible");
      window.setTimeout(() => status.classList.remove("visible", "generating"), 2200);
    }
  }
}
