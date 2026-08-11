type WorkspaceKeyboardOptions = {
  closeQuickMenu: () => boolean;
  closeNodeInfo: () => boolean;
  closeAssetPreview: () => boolean;
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
};

export class WorkspaceKeyboardController {
  constructor(private readonly options: WorkspaceKeyboardOptions) {
    window.addEventListener("keydown", (event) => this.handle(event));
  }

  private handle(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const editing = Boolean(target?.matches('input, textarea, select, [contenteditable="true"]'));
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !editing && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.options.redo();
      else this.options.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !editing && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.options.redo();
      return;
    }
    if (event.key === "Escape") {
      if (this.options.closeQuickMenu()) return;
      if (this.options.closeNodeInfo()) return;
      if (this.options.closeAssetPreview()) return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (editing) return;
    event.preventDefault();
    this.options.deleteSelected();
  }
}
