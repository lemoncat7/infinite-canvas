import type { FlowLink, FlowNode } from "../nodes/node-types";
import { hydrateGenerationState } from "../services/generation";
import { normalizeCanvasDocument } from "./document-normalizer";
import { repairRestoredCanvas } from "./restoration";
import { diffCanvasSnapshots, normalizeCanvasLinks, type CanvasSyncSnapshot } from "./sync";
import { fetchCanvasDocument } from "./sync-client";
import type { CanvasSaveCoordinator } from "./save-coordinator";

export class CanvasLoadCoordinator {
  constructor(
    private readonly deps: {
      save: CanvasSaveCoordinator;
      nodes: FlowNode[];
      links: FlowLink[];
      camera: { x: number; y: number; zoom: number };
      projectId: () => string;
      normalizePrompt: (value: string) => string;
      clearViews: () => void;
      cancelPolling: () => void;
      getLease: () => { nextId: number; end: number };
      restoreLease: (nextId: number, end: number) => void;
      resetLease: (nextId: number) => void;
      needsLease: () => boolean;
      reserveIds: (projectId: string) => Promise<boolean>;
      syncCamera: () => void;
      setBootStatus: (message: string) => number;
      hideBootStatus: (version: number, delay: number) => void;
      hideConflictGuide: () => void;
      clearSelection: () => void;
      setSavedState: () => void;
      setOfflineState: () => void;
      update: () => void;
      draw: () => void;
      resetHistory: (captureCurrent: boolean) => void;
      capture: () => CanvasSyncSnapshot;
      scheduleSave: () => void;
      pollJob: (node: FlowNode) => void;
      runAgentWorkflow: () => void;
    },
  ) {}

  async load(keepLoadingStatus = false) {
    const sequence = this.deps.save.beginLoad();
    try {
      const projectId = this.deps.projectId();
      const lease = this.deps.getLease();
      this.deps.setBootStatus("正在读取画布与生成任务");
      this.deps.cancelPolling();
      const result = await fetchCanvasDocument(projectId);
      if (!this.deps.save.isCurrentLoad(sequence, projectId)) return;
      if (result.kind === "missing") {
        this.deps.save.loadedProjectId = projectId;
        await this.deps.save.save();
        this.deps.resetHistory(false);
        return;
      }
      const document = result.document;
      const normalized = normalizeCanvasDocument(
        document,
        this.deps.camera,
        this.deps.normalizePrompt,
      );
      document.nodes = normalized.nodes;
      document.links = normalized.links;
      this.deps.clearViews();
      this.deps.nodes.splice(0, this.deps.nodes.length, ...normalized.nodes);
      await hydrateGenerationState(this.deps.nodes);
      this.deps.links.splice(
        0,
        this.deps.links.length,
        ...normalizeCanvasLinks(document.links ?? []),
      );
      if (lease.nextId <= lease.end)
        this.deps.restoreLease(lease.nextId, lease.end);
      else
        this.deps.resetLease(
          this.deps.nodes.length
            ? Math.max(...this.deps.nodes.map((node) => node.id)) + 1
            : 1,
        );
      const { repositionedResult } = repairRestoredCanvas(
        this.deps.nodes,
        this.deps.links,
      );
      if (document.camera) {
        Object.assign(this.deps.camera, document.camera);
        this.deps.syncCamera();
      }
      if (!this.deps.save.isCurrentLoad(sequence, projectId)) return;
      if (this.deps.needsLease()) {
        this.deps.setBootStatus("正在申请安全节点空间");
        if (!(await this.deps.reserveIds(projectId)))
          throw new Error("canvas id lease failed");
      } else this.deps.setBootStatus("正在校验节点编号空间");
      if (!this.deps.save.isCurrentLoad(sequence, projectId)) return;
      this.deps.save.completeLoad(projectId, normalized.baseline);
      this.deps.hideConflictGuide();
      this.deps.clearSelection();
      this.deps.setSavedState();
      this.deps.update();
      this.deps.draw();
      this.deps.resetHistory(true);
      if (
        repositionedResult ||
        diffCanvasSnapshots(normalized.baseline, this.deps.capture()).length
      )
        this.deps.scheduleSave();
      this.deps.nodes
        .filter(
          (node) =>
            node.jobId &&
            (node.status === "queued" || node.status === "running"),
        )
        .forEach(this.deps.pollJob);
      queueMicrotask(this.deps.runAgentWorkflow);
      if (!keepLoadingStatus) {
        const version = this.deps.setBootStatus("已同步服务器最新版本");
        this.deps.hideBootStatus(version, 650);
      }
    } catch {
      this.deps.setOfflineState();
      if (!keepLoadingStatus) {
        const version = this.deps.setBootStatus("同步失败，请检查连接");
        this.deps.hideBootStatus(version, 1800);
      }
    }
  }
}
