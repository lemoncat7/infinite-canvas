export class ComicStudioLifecycleController {
  constructor(private readonly options: {
    studio: HTMLElement;
    briefPanel: HTMLElement;
    planPanel: HTMLElement;
    promptPanel: HTMLElement;
    getOwnerKey: () => string;
    getStoredOwnerKey: () => string;
    setStoredOwnerKey: (owner: string) => void;
    hasProject: () => boolean;
    hasAuthenticatedContext: () => boolean;
    ensureProject: () => Promise<boolean>;
    resetConversation: (clearPlan: boolean) => void;
    invalidateSession: () => void;
    restoreSession: (force?: boolean) => Promise<unknown>;
    resetMarqueeGesture: () => void;
    isMultiSelect: () => boolean;
    exitMultiSelect: () => void;
    closePromptAgent: () => void;
    renderLabelState: () => void;
    renderBrief: () => void;
  }) {}

  async ensureProjectContext() {
    const previousOwner = this.options.getStoredOwnerKey();
    if (!(await this.options.ensureProject())) return false;
    const owner = this.options.getOwnerKey();
    if (previousOwner && previousOwner !== owner)
      this.options.resetConversation(true);
    this.options.setStoredOwnerKey(owner);
    return this.options.hasProject();
  }

  async restoreAfterReconnect() {
    if (!this.options.studio.classList.contains("open") ||
        !this.options.hasAuthenticatedContext()) return;
    this.options.invalidateSession();
    await this.options.restoreSession(true);
  }

  open() {
    const field = this.options.studio.querySelector<HTMLTextAreaElement>(
      "[data-comic-message]",
    )!;
    const seed = this.options.promptPanel
      .querySelector<HTMLTextAreaElement>("textarea")!
      .value.trim();
    this.options.resetMarqueeGesture();
    if (this.options.isMultiSelect()) this.options.exitMultiSelect();
    this.options.closePromptAgent();
    if (this.options.getStoredOwnerKey() &&
        this.options.getStoredOwnerKey() !== this.options.getOwnerKey()) {
      this.options.resetConversation(true);
      this.options.invalidateSession();
    }
    this.options.setStoredOwnerKey(this.options.getOwnerKey());
    this.options.studio.classList.add("open");
    this.options.planPanel.classList.add("studio-open");
    this.options.promptPanel.classList.add("comic-hidden");
    this.options.renderLabelState();
    this.options.renderBrief();
    void this.options.restoreSession();
    if (seed && !field.value) field.value = seed;
    field.focus();
  }

  close() {
    this.options.studio.classList.remove("open");
    this.options.briefPanel.hidden = true;
    this.options.planPanel.classList.remove("studio-open", "mobile-open");
    this.options.promptPanel.classList.remove("comic-hidden");
    this.options.closePromptAgent();
  }
}
