import type { CanvasSyncSnapshot } from "./sync";
import { submitCanvasChanges } from "./sync-client";

export class CanvasSaveCoordinator {
  loadedProjectId = "";
  serverVersion = 0;
  serverUpdatedAt = "";
  baseline: CanvasSyncSnapshot | null = null;
  blocked = true;
  loadSequence = 0;

  private timer: number | undefined;
  private inFlight: Promise<void> | null = null;
  private queued = false;
  private abort: AbortController | null = null;

  constructor(
    private readonly deps: {
      clientId: string;
      authenticated: () => boolean;
      projectId: () => string;
      capture: () => CanvasSyncSnapshot;
      applyMerged: (snapshot: CanvasSyncSnapshot) => void;
      setState: (state: "editing" | "saving" | "saved" | "error", label: string) => void;
      showConflict: (emptyGuard: boolean) => void;
      reload: () => Promise<void>;
    },
  ) {}

  schedule(recordHistory: () => void, record = true) {
    this.deps.setState("editing", "编辑中…");
    if (record) recordHistory();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.save(), 500);
  }

  async save() {
    const projectId = this.deps.projectId();
    if (
      !this.deps.authenticated() ||
      this.blocked ||
      this.loadedProjectId !== projectId ||
      !this.baseline ||
      this.baseline.version !== this.serverVersion
    )
      return;
    if (this.inFlight) {
      this.queued = true;
      return this.inFlight;
    }
    const controller = new AbortController();
    const sentSnapshot = this.deps.capture();
    this.abort = controller;
    this.inFlight = this.submit(projectId, sentSnapshot, controller);
    return this.inFlight;
  }

  beginLoad() {
    this.blocked = true;
    window.clearTimeout(this.timer);
    this.queued = false;
    return ++this.loadSequence;
  }

  isCurrentLoad(sequence: number, projectId: string) {
    return sequence === this.loadSequence && projectId === this.deps.projectId();
  }

  completeLoad(projectId: string, baseline: CanvasSyncSnapshot) {
    this.loadedProjectId = projectId;
    this.baseline = baseline;
    this.serverVersion = baseline.version;
    this.serverUpdatedAt = baseline.updatedAt;
    this.blocked = false;
  }

  async stopAndReset(wait = false) {
    window.clearTimeout(this.timer);
    this.queued = false;
    this.blocked = true;
    this.abort?.abort();
    if (wait) await this.inFlight?.catch(() => {});
    this.loadedProjectId = "";
    this.baseline = null;
    this.serverVersion = 0;
    this.serverUpdatedAt = "";
  }

  async prepareExclusiveMutation() {
    window.clearTimeout(this.timer);
    this.queued = false;
    this.blocked = true;
    this.abort?.abort();
    await this.inFlight?.catch(() => {});
  }

  applyAuthoritativeSnapshot(snapshot: CanvasSyncSnapshot) {
    this.serverVersion = snapshot.version;
    this.serverUpdatedAt = snapshot.updatedAt || this.serverUpdatedAt;
    this.baseline = structuredClone(snapshot);
    this.blocked = false;
  }

  private async submit(
    projectId: string,
    sentSnapshot: CanvasSyncSnapshot,
    controller: AbortController,
  ) {
    try {
      this.deps.setState("saving", "正在自动保存…");
      const result = await submitCanvasChanges({
        projectId,
        clientId: this.deps.clientId,
        baseline: this.baseline!,
        sentSnapshot,
        captureLive: this.deps.capture,
        signal: controller.signal,
      });
      if (result.kind === "unchanged") {
        this.deps.setState("saved", "已自动保存");
        return;
      }
      if (result.kind === "conflict") {
        this.queued = false;
        this.blocked = true;
        const emptyGuard = result.error === "canvas_empty_guard";
        this.deps.setState(
          "error",
          emptyGuard ? "已阻止空画布覆盖" : "版本需要同步",
        );
        this.deps.showConflict(emptyGuard);
        await this.deps.reload();
        return;
      }
      if (projectId === this.deps.projectId()) {
        this.baseline = structuredClone(result.serverSnapshot);
        this.serverUpdatedAt = result.serverSnapshot.updatedAt;
        this.serverVersion = result.serverSnapshot.version;
        this.deps.applyMerged(result.mergedSnapshot);
        if (result.hasPostSubmitOperations) this.queued = true;
      }
      this.deps.setState("saved", "已自动保存");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        this.deps.setState("error", "自动保存失败");
    } finally {
      if (this.abort === controller) this.abort = null;
      this.inFlight = null;
      if (
        this.queued &&
        !this.blocked &&
        this.loadedProjectId === this.deps.projectId()
      ) {
        this.queued = false;
        void this.save();
      }
    }
  }
}
