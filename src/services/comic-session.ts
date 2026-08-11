import {
  fetchComicSession,
  type ComicSessionSnapshot,
} from "./comic";

interface ComicSessionControllerOptions {
  getProjectId: () => string;
  getOwnerKey: () => string;
  getTrackedSessionId: () => string;
  onEmpty: () => void | Promise<void>;
  onSnapshot: (snapshot: ComicSessionSnapshot) => void | Promise<void>;
}

export class ComicSessionController {
  private restoredOwnerKey = "";
  private refreshTimer = 0;

  constructor(private readonly options: ComicSessionControllerOptions) {}

  invalidate() {
    this.restoredOwnerKey = "";
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
  }

  async restore(force = false) {
    const projectId = this.options.getProjectId();
    if (!projectId) return;
    const ownerKey = this.options.getOwnerKey();
    if (!force && this.restoredOwnerKey === ownerKey) return;
    this.restoredOwnerKey = ownerKey;
    try {
      const snapshot = await fetchComicSession(
        projectId,
        this.options.getTrackedSessionId(),
      );
      if (ownerKey !== this.options.getOwnerKey()) return;
      if (snapshot === null) {
        await this.options.onEmpty();
        return;
      }
      if (!snapshot) return;
      await this.options.onSnapshot(snapshot);
      if (snapshot.generationStatus === "running") {
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
          this.restoredOwnerKey = "";
          void this.restore(true);
        }, 2500);
      }
    } catch {
      // 网络恢复或下次打开时重新读取，保留当前页面状态。
    }
  }
}
