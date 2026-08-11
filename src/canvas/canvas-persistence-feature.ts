import type { FlowLink, FlowNode } from "../nodes/node-types";
import { normalizeCanvasLinks, type CanvasSyncSnapshot } from "./sync";
import { CanvasClearController } from "./clear-controller";
import { CanvasClearResultApplier } from "./clear-result-applier";
import { CanvasLoadCoordinator } from "./load-coordinator";
import { CanvasSaveCoordinator } from "./save-coordinator";
import { CanvasSnapshotController } from "./canvas-snapshot-controller";

type SaveState = "editing" | "saving" | "saved" | "error";

export class CanvasPersistenceFeature {
  private readonly snapshots: CanvasSnapshotController;
  private saveCoordinator!: CanvasSaveCoordinator;
  private readonly loadCoordinator: CanvasLoadCoordinator;

  constructor(options: {
    clientId: string;
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    authenticated: () => boolean;
    getProjectId: () => string;
    getSelectedId: () => number;
    setSelectedId: (id: number) => void;
    normalizePrompt: (value?: string) => string;
    syncCamera: () => void;
    ensureNodeIdAtLeast: (value: number) => void;
    clearViews: () => void;
    cancelPolling: () => void;
    getLease: () => { nextId: number; end: number };
    restoreLease: (nextId: number, end: number) => void;
    resetLease: (value?: number) => void;
    needsLease: () => boolean;
    reserveIds: (projectId: string) => Promise<boolean>;
    setBootStatus: (message: string) => number;
    hideBootStatus: (version: number, delay: number) => void;
    hideConflictGuide: () => void;
    showConflict: (emptyGuard: boolean) => void;
    setState: (state: SaveState, label: string) => void;
    updateEditor: () => void;
    draw: () => void;
    resetHistory: (restore?: boolean) => void;
    queueHistory: () => void;
    pollJob: (node: FlowNode) => void;
    runWorkflow: () => void;
    clearButton: HTMLElement;
    notifyClear: (retainedLabels: number) => void;
    toast: (message: string, tone: "success" | "warning" | "error", detail?: string) => void;
  }) {
    this.snapshots = new CanvasSnapshotController({
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      selectedId: options.getSelectedId,
      setSelectedId: options.setSelectedId,
      serverVersion: () => this.saveCoordinator.serverVersion,
      serverUpdatedAt: () => this.saveCoordinator.serverUpdatedAt,
      syncCameraTarget: options.syncCamera,
      ensureNodeIdAtLeast: options.ensureNodeIdAtLeast,
      updateEditor: options.updateEditor,
      draw: options.draw,
    });
    this.saveCoordinator = new CanvasSaveCoordinator({
      clientId: options.clientId,
      authenticated: options.authenticated,
      projectId: options.getProjectId,
      capture: () => this.capture(),
      applyMerged: (snapshot) => this.apply(snapshot),
      setState: options.setState,
      showConflict: options.showConflict,
      reload: () => this.load(),
    });
    this.loadCoordinator = new CanvasLoadCoordinator({
      save: this.saveCoordinator,
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      projectId: options.getProjectId,
      normalizePrompt: options.normalizePrompt,
      clearViews: options.clearViews,
      cancelPolling: options.cancelPolling,
      getLease: options.getLease,
      restoreLease: options.restoreLease,
      resetLease: options.resetLease,
      needsLease: options.needsLease,
      reserveIds: options.reserveIds,
      syncCamera: options.syncCamera,
      setBootStatus: options.setBootStatus,
      hideBootStatus: options.hideBootStatus,
      hideConflictGuide: options.hideConflictGuide,
      clearSelection: () => options.setSelectedId(0),
      setSavedState: () => options.setState("saved", "已自动保存"),
      setOfflineState: () => options.setState("error", "离线模式"),
      update: options.updateEditor,
      draw: options.draw,
      resetHistory: options.resetHistory,
      capture: () => this.capture(),
      scheduleSave: () => this.schedule(options.queueHistory),
      pollJob: options.pollJob,
      runAgentWorkflow: options.runWorkflow,
    });
    const clearResult = new CanvasClearResultApplier({
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      normalizeLinks: normalizeCanvasLinks,
      applySnapshot: (version, updatedAt) => this.saveCoordinator.applyAuthoritativeSnapshot(
        this.capture(version, updatedAt || this.saveCoordinator.serverUpdatedAt),
      ),
      clearSelection: () => options.setSelectedId(0),
      resetHistory: () => options.resetHistory(false),
      updateEditor: options.updateEditor,
      markSaved: () => options.setState("saved", "已自动保存"),
      draw: options.draw,
      notify: options.notifyClear,
    });
    new CanvasClearController({
      button: options.clearButton,
      getNodeCount: () => options.nodes.length,
      getProjectId: options.getProjectId,
      getServerVersion: () => this.saveCoordinator.serverVersion,
      prepareForClear: () => this.saveCoordinator.prepareExclusiveMutation(),
      applyResult: (result) => clearResult.apply(result),
      recoverCanvas: () => this.load(),
      toast: options.toast,
    });
  }

  get loadedProjectId() { return this.saveCoordinator.loadedProjectId; }
  get blocked() { return this.saveCoordinator.blocked; }
  get serverVersion() { return this.saveCoordinator.serverVersion; }
  get serverUpdatedAt() { return this.saveCoordinator.serverUpdatedAt; }
  capture(version?: number, updatedAt?: string) { return this.snapshots.capture(version, updatedAt); }
  apply(snapshot: CanvasSyncSnapshot, preserveSelection = true) {
    this.snapshots.apply(snapshot, preserveSelection);
  }
  schedule(queueHistory: () => void, recordHistory = true) {
    this.saveCoordinator.schedule(queueHistory, recordHistory);
  }
  save() { return this.saveCoordinator.save(); }
  load(keepLoadingStatus = false) { return this.loadCoordinator.load(keepLoadingStatus); }
  stopAndReset(logout?: boolean) { return this.saveCoordinator.stopAndReset(logout); }
  prepareExclusiveMutation() { return this.saveCoordinator.prepareExclusiveMutation(); }
}
