import {
  deleteAsset,
  type LibraryAsset,
  updateAssetVisibility,
} from "../services/assets";
import { ContextMenuController } from "./context-menu";

export type AssetContextKind = "image" | "video";

type SelectedAsset = {
  id: string;
  url: string;
  name: string;
  kind: AssetContextKind;
  isPublic: boolean;
};

type AssetContextControllerOptions = {
  menu: HTMLElement;
  placeButton: HTMLElement;
  previewButton: HTMLElement;
  publishButton: HTMLElement;
  publishLabel: HTMLElement;
  deleteButton: HTMLElement;
  onPlace: (asset: SelectedAsset) => void;
  onPreview: (asset: SelectedAsset) => void;
  onCloseWorkspace: () => void;
  onVisibilityChanged: () => void;
  onDeleted: (asset: SelectedAsset) => void;
  reloadAssets: () => Promise<unknown>;
  toast: (message: string, type: "success" | "error") => void;
};

export class AssetContextController {
  private selected: SelectedAsset | null = null;
  private readonly contextMenu: ContextMenuController;

  constructor(private readonly options: AssetContextControllerOptions) {
    this.contextMenu = new ContextMenuController(options.menu);
    options.placeButton.addEventListener("click", () => this.place());
    options.previewButton.addEventListener("click", () => this.preview());
    options.publishButton.addEventListener("click", () => {
      void this.toggleVisibility();
    });
    options.deleteButton.addEventListener("click", () => {
      void this.remove();
    });
  }

  open(asset: LibraryAsset, x: number, y: number) {
    const kind = asset.mimeType.startsWith("video/") ? "video" : "image";
    this.selected = {
      id: asset.id,
      url: asset.url,
      name: asset.name,
      kind,
      isPublic: asset.isPublic,
    };
    this.syncPublishLabel();
    const width = innerWidth <= 800 ? 210 : 190;
    this.contextMenu.openAt(x - 18, y - 24, width, 250);
  }

  closeIfOutside(target: Node) {
    if (!this.contextMenu.contains(target)) this.contextMenu.close();
  }

  private place() {
    const asset = this.selected;
    if (asset) this.options.onPlace(asset);
    this.contextMenu.close();
    this.options.onCloseWorkspace();
  }

  private preview() {
    const asset = this.selected;
    if (asset) this.options.onPreview(asset);
    this.contextMenu.close();
  }

  private async toggleVisibility() {
    const asset = this.selected;
    if (!asset) return;
    const next = !asset.isPublic;
    this.contextMenu.close();
    try {
      await updateAssetVisibility(asset.id, next);
    } catch {
      this.options.toast("主页展示状态更新失败", "error");
      return;
    }
    asset.isPublic = next;
    this.syncPublishLabel();
    this.options.onVisibilityChanged();
    this.options.toast(
      next ? "作品已展示到主页" : "作品已从主页撤下",
      "success",
    );
    await this.options.reloadAssets();
  }

  private async remove() {
    const asset = this.selected;
    if (!asset || !window.confirm(`确定删除“${asset.name}”吗？`)) return;
    const response = await deleteAsset(asset.id);
    if (!response.ok) {
      window.alert("删除失败，请重试");
      return;
    }
    this.options.onDeleted(asset);
    this.selected = null;
    this.contextMenu.close();
    await this.options.reloadAssets();
  }

  private syncPublishLabel() {
    this.options.publishLabel.textContent = this.selected?.isPublic
      ? "从主页撤下"
      : "展示到主页";
  }
}
