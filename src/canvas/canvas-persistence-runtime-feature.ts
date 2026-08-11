import { CanvasPersistenceFeature } from "./canvas-persistence-feature";

type PersistenceOptions = ConstructorParameters<typeof CanvasPersistenceFeature>[0];

export class CanvasPersistenceRuntimeFeature {
  private readonly feature: CanvasPersistenceFeature;

  constructor(
    private readonly saveState: HTMLElement,
    history: { reset: (restore?: boolean) => void; queue: () => void },
    options: Omit<PersistenceOptions, "setState" | "resetHistory" | "queueHistory">,
  ) {
    this.feature = new CanvasPersistenceFeature({
      ...options,
      setState: (state, label) => {
        this.saveState.dataset.state = state;
        this.saveState.textContent = label;
      },
      resetHistory: history.reset,
      queueHistory: history.queue,
    });
    this.queueHistory = history.queue;
  }

  private readonly queueHistory: () => void;

  get blocked() { return this.feature.blocked; }
  get loadedProjectId() { return this.feature.loadedProjectId; }
  get serverVersion() { return this.feature.serverVersion; }

  schedule = (recordHistory = true) =>
    this.feature.schedule(this.queueHistory, recordHistory);
  save = () => this.feature.save();
  load = (keepLoadingStatus = false) => this.feature.load(keepLoadingStatus);
  stopAndReset = (logout = false) => this.feature.stopAndReset(logout);

  setEditing() {
    // Keep transient editor state in the same persistence-owned indicator.
    this.saveState.dataset.state = "editing";
    this.saveState.textContent = "编辑中…";
  }
}
