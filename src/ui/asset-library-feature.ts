import type { FlowNode, Point } from "../nodes/node-types";
import { ImageAssetController } from "../nodes/image-asset-controller";
import type { LibraryAsset } from "../services/assets";
import { AssetBulkController } from "./asset-bulk-controller";
import { AssetContextController } from "./asset-context-controller";
import { AssetLibraryController } from "./asset-library-controller";
import { AssetLibraryView } from "./asset-library-view";
import { AssetTouchController } from "./asset-touch-controller";
import { AssetUploadController } from "./asset-upload-controller";

type Tone = "success" | "warning" | "error";

export class AssetLibraryFeature {
  readonly library: AssetLibraryController;
  private readonly imageAssets: ImageAssetController;
  private readonly upload: AssetUploadController;
  private readonly context: AssetContextController;

  constructor(private readonly options: {
    nodes: FlowNode[];
    getProjectId: () => string;
    center: () => Point;
    addMedia: (url: string, title: string, position: Point, kind: "image" | "video") => void;
    preview: (url: string, name: string, kind: "image" | "video") => void;
    closePanels: () => void;
    openPanel: () => void;
    invalidateShowcase: () => void;
    deleteCachedImage: (url: string) => void;
    selectNode: (id: number) => void;
    save: () => void;
    updateEditor: () => void;
    draw: () => void;
    confirmDelete: (count: number) => Promise<boolean>;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const grid = document.querySelector<HTMLElement>("#asset-grid")!;
    const count = document.querySelector<HTMLElement>("#asset-count")!;
    const search = document.querySelector<HTMLInputElement>("#asset-search")!;
    const projectFilter = document.querySelector<HTMLSelectElement>("#asset-project-filter")!;
    const typeFilter = document.querySelector<HTMLSelectElement>("#asset-type-filter")!;
    const sort = document.querySelector<HTMLSelectElement>("#asset-sort")!;
    typeFilter.insertAdjacentHTML("beforeend", '<option value="audio">音频</option>');

    this.context = new AssetContextController({
      menu: document.querySelector<HTMLElement>("#asset-context-menu")!,
      placeButton: document.querySelector<HTMLElement>("#asset-context-place")!,
      previewButton: document.querySelector<HTMLElement>("#asset-context-preview")!,
      publishButton: document.querySelector<HTMLElement>("#asset-context-publish")!,
      publishLabel: document.querySelector<HTMLElement>("#asset-context-publish span")!,
      deleteButton: document.querySelector<HTMLElement>("#asset-context-delete")!,
      onPlace: (asset) => options.addMedia(asset.url, asset.name, options.center(), asset.kind),
      onPreview: (asset) => options.preview(asset.url, asset.name, asset.kind),
      onCloseWorkspace: options.closePanels,
      onVisibilityChanged: options.invalidateShowcase,
      onDeleted: (asset) => options.deleteCachedImage(asset.url),
      reloadAssets: () => this.load(),
      toast: (message, tone) => options.toast(message, tone),
    });
    const openContext = (asset: LibraryAsset, x: number, y: number) => this.context.open(asset, x, y);
    let touch!: AssetTouchController<LibraryAsset>;
    const bulk = new AssetBulkController({
      deleteButton: document.querySelector<HTMLButtonElement>("#asset-bulk-delete")!,
      downloadButton: document.querySelector<HTMLButtonElement>("#asset-bulk-download")!,
      getAssets: () => this.library.allAssets,
      confirmDelete: options.confirmDelete,
      reloadAssets: () => this.load(),
      toast: (message, tone) => options.toast(message, tone),
    });
    const view = new AssetLibraryView({
      grid,
      count,
      pageSize: 36,
      selectedIds: bulk.selectedIds,
      bulkDelete: document.querySelector<HTMLButtonElement>("#asset-bulk-delete")!,
      bulkDownload: document.querySelector<HTMLButtonElement>("#asset-bulk-download")!,
      isTouchContextBlocked: () => touch.isContextBlocked(),
      onOpen: (asset, kind) => options.preview(asset.url, asset.name, kind),
      onAudio: (asset) => this.library.playAudio(asset),
      onPickImage: (asset) => {
        const targetId = this.library.consumeImageTarget();
        if (targetId) this.imageAssets.attach(targetId, asset);
        options.closePanels();
      },
      onContext: openContext,
    });
    this.library = new AssetLibraryController({
      search,
      projectFilter,
      typeFilter,
      sort,
      viewButtons: document.querySelectorAll<HTMLButtonElement>("[data-asset-view]"),
      getCurrentProjectId: options.getProjectId,
      getView: () => view,
      showError: (message) => options.toast(message, "error"),
    });
    touch = new AssetTouchController({
      grid,
      resolveAsset: (item) => this.library.resolveItem(item),
      onContext: openContext,
    });

    const assetInput = document.querySelector<HTMLInputElement>("#asset-upload")!;
    const nodeInput = document.createElement("input");
    nodeInput.type = "file";
    nodeInput.accept = "image/*";
    nodeInput.hidden = true;
    document.body.append(nodeInput);
    this.upload = new AssetUploadController({
      input: assetInput,
      nodeInput,
      button: document.querySelector<HTMLButtonElement>("#upload-assets")!,
      triggers: [
        document.querySelector<HTMLElement>("#upload-assets")!,
        document.querySelector<HTMLElement>("#dock-upload")!,
      ],
      getProjectId: options.getProjectId,
      getPastePosition: options.center,
      onAttachNode: (nodeId, asset) => this.imageAssets.attach(nodeId, asset),
      onPlace: (position, asset) => options.addMedia(asset.url, asset.name, position, "image"),
      onReload: () => this.load(),
      onToast: options.toast,
    });
    this.imageAssets = new ImageAssetController({
      nodes: options.nodes,
      select: options.selectNode,
      save: options.save,
      updateEditor: options.updateEditor,
      draw: options.draw,
      notify: (message, tone) => options.toast(message, tone),
      clearLibraryTarget: () => this.library.setImageTarget(null),
      openUpload: (nodeId) => this.upload.openForNode(nodeId),
      openLibraryPanel: options.openPanel,
      setLibraryTarget: (nodeId) => this.library.setImageTarget(nodeId),
      selectImageFilter: () => {
        typeFilter.value = "image";
        projectFilter.value = "current";
      },
      loadAssets: () => this.load(),
      renderAssets: () => this.render(),
    });
  }

  get hasAssets() { return this.library.hasAssets; }
  load(render = true) { return this.library.load(render); }
  render() { this.library.render(); }
  openUploadAt(position: Point | null = null) { this.upload.open(position); }
  beginNodeUpload(nodeId: number) { this.imageAssets.beginUpload(nodeId); }
  beginNodeLibrary(nodeId: number) { return this.imageAssets.beginLibrary(nodeId); }
  allowsSourceChange(nodeId: number) { return this.imageAssets.allowsSourceChange(nodeId); }
  attach(nodeId: number, asset: { url: string; name: string }) { this.imageAssets.attach(nodeId, asset); }
  setImageTarget(nodeId: number | null) { this.library.setImageTarget(nodeId); }
  closeContextIfOutside(target: Node) { this.context.closeIfOutside(target); }
}
