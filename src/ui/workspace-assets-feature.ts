import type { FlowNode, Point } from "../nodes/node-types";
import { ProjectSwitchController } from "../app/project-switch-controller";
import { AssetLibraryFeature } from "./asset-library-feature";
import { AssetPreviewController } from "./asset-preview";
import { ProjectController } from "./project-controller";
import { SquarePanelView } from "./square-panel";
import { WorkspacePanelController } from "./toolbar";
import { WorkspaceNavigationCoordinator } from "./workspace-navigation-coordinator";

type Tone = "success" | "warning" | "error" | "info";
type Ask = (options: {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
}) => Promise<string | boolean>;

export class WorkspaceAssetsFeature {
  private readonly panels: WorkspacePanelController;
  private readonly preview: AssetPreviewController;
  private readonly library: AssetLibraryFeature;
  private readonly projectSwitch: ProjectSwitchController;
  private readonly projects: ProjectController;
  private readonly square: SquarePanelView;

  constructor(options: {
    nodes: FlowNode[];
    getProjectId: () => string;
    setProjectId: (id: string) => void;
    getLoadedProjectId: () => string;
    center: () => Point;
    addMedia: (url: string, title: string, position: Point, kind?: "image" | "video") => void;
    selectNode: (id: number) => void;
    saveCanvas: () => Promise<unknown>;
    scheduleSave: () => void;
    stopSave: () => Promise<void>;
    resetNodeLease: () => void;
    loadCanvas: () => Promise<unknown>;
    closeComic: () => void;
    resetComic: () => void;
    unlinkComicLabel: () => void;
    invalidateShowcase: () => void;
    deleteCachedImage: (url: string) => void;
    updateEditor: () => void;
    draw: () => void;
    closeTopbarMenus: (opening?: boolean) => void;
    registerWorkspaceMenu: (close: () => void) => void;
    ask: Ask;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const brand = document.querySelector<HTMLElement>(".topbar .brand")!;
    this.panels = new WorkspacePanelController(
      document.querySelectorAll<HTMLElement>(".workspace-panel"),
      document.querySelector<HTMLElement>("#panel-backdrop")!,
      brand,
      document.querySelector<HTMLButtonElement>("#mobile-nav-toggle")!,
      () => this.library?.setImageTarget(null),
    );
    options.registerWorkspaceMenu(() => this.panels.closeMobileMenu());
    this.preview = new AssetPreviewController({
      modal: document.querySelector<HTMLElement>("#asset-preview")!,
      image: document.querySelector<HTMLImageElement>("#preview-image")!,
      video: document.querySelector<HTMLVideoElement>("#preview-video")!,
      name: document.querySelector<HTMLElement>("#preview-name")!,
      closeButton: document.querySelector<HTMLElement>("#close-preview")!,
    });
    this.library = new AssetLibraryFeature({
      nodes: options.nodes,
      getProjectId: options.getProjectId,
      center: options.center,
      addMedia: options.addMedia,
      preview: (url, name, kind) => this.openPreview(url, name, kind),
      closePanels: () => this.panels.close(),
      openPanel: () => this.openPanel("#assets-panel", "#open-assets"),
      invalidateShowcase: options.invalidateShowcase,
      deleteCachedImage: options.deleteCachedImage,
      selectNode: options.selectNode,
      save: options.scheduleSave,
      updateEditor: options.updateEditor,
      draw: options.draw,
      confirmDelete: async (count) => Boolean(await options.ask({
        title: "删除所选资产？",
        description: `将永久删除所选的 ${count} 项资产，此操作无法撤销。`,
        confirm: "确认删除",
        danger: true,
      })),
      toast: options.toast,
    });
    this.projectSwitch = new ProjectSwitchController({
      currentProjectId: options.getProjectId,
      setCurrentProjectId: options.setProjectId,
      loadedProjectId: options.getLoadedProjectId,
      save: options.saveCanvas,
      stopSave: options.stopSave,
      resetNodeLease: options.resetNodeLease,
      closeComic: options.closeComic,
      resetComic: options.resetComic,
      unlinkComicLabel: options.unlinkComicLabel,
      loadCanvas: options.loadCanvas,
      loadAssets: () => this.loadAssets(),
      closePanels: () => this.panels.close(),
    });
    this.projects = new ProjectController({
      list: document.querySelector<HTMLElement>("#project-list")!,
      count: document.querySelector<HTMLElement>("#project-count")!,
      search: document.querySelector<HTMLInputElement>("#project-search")!,
      sort: document.querySelector<HTMLSelectElement>("#project-sort")!,
      newButton: document.querySelector<HTMLElement>("#new-project")!,
      ask: options.ask,
      getCurrentProjectId: options.getProjectId,
      switchProject: (id) => this.switchProject(id),
      deleteCurrentProject: (id) => this.projectSwitch.selectAfterDelete(id),
      toast: options.toast,
    });
    this.square = new SquarePanelView({
      grid: document.querySelector<HTMLElement>("#square-grid")!,
      count: document.querySelector<HTMLElement>("#square-count")!,
      search: document.querySelector<HTMLInputElement>("#square-search")!,
      pageSize: 36,
      onOpen: (asset, kind) => this.openPreview(asset.url, asset.name, kind),
    });
    document.querySelector("#square-refresh")!
      .addEventListener("click", () => void this.square.load());
    new WorkspaceNavigationCoordinator({
      panels: this.panels,
      brand,
      hasAssets: () => this.library.hasAssets,
      loadAssets: () => this.loadAssets(false),
      renderAssets: () => this.renderAssets(),
      loadProjects: () => { void this.projects.load(); },
      loadSquare: () => { void this.square.load(); },
      toggleTopbar: options.closeTopbarMenus,
    }).bind();
  }

  openUploadAt(position: Point | null = null) { this.library.openUploadAt(position); }
  beginNodeUpload(nodeId: number) { this.library.beginNodeUpload(nodeId); }
  beginNodeLibrary(nodeId: number) { return this.library.beginNodeLibrary(nodeId); }
  loadAssets(render = true) { return this.library.load(render); }
  renderAssets() { this.library.render(); }
  switchProject(projectId: string) { return this.projectSwitch.switch(projectId); }
  openPreview(url: string, name: string, kind: "image" | "video" = "image") {
    this.preview.open(url, name, kind);
  }
  closePreview() { this.preview.close(); }
  get isPreviewOpen() { return this.preview.isOpen; }
  closeContextIfOutside(target: Node) { this.library.closeContextIfOutside(target); }

  private openPanel(panel: string, trigger: string) {
    this.panels.open(
      document.querySelector<HTMLElement>(panel)!,
      document.querySelector<HTMLElement>(trigger)!,
    );
  }
}
