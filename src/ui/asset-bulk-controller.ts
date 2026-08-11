import {
  deleteAssets,
  fetchAssetBlob,
  type LibraryAsset,
} from "../services/assets";

type AssetBulkControllerOptions = {
  deleteButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  getAssets: () => LibraryAsset[];
  confirmDelete: (count: number) => Promise<boolean>;
  reloadAssets: () => Promise<unknown>;
  toast: (message: string, type: "success" | "error") => void;
};

export class AssetBulkController {
  readonly selectedIds = new Set<string>();

  constructor(private readonly options: AssetBulkControllerOptions) {
    options.deleteButton.addEventListener("click", () => {
      void this.removeSelected();
    });
    options.downloadButton.addEventListener("click", () => {
      void this.downloadSelected();
    });
  }

  private async removeSelected() {
    const count = this.selectedIds.size;
    if (!count || !(await this.options.confirmDelete(count))) return;
    const failed = await deleteAssets(this.selectedIds);
    this.options.toast(
      failed ? "部分资产删除失败" : "所选资产已删除",
      failed ? "error" : "success",
    );
    this.selectedIds.clear();
    await this.options.reloadAssets();
  }

  private async downloadSelected() {
    const selected = this.options
      .getAssets()
      .filter((asset) => this.selectedIds.has(asset.id));
    for (const asset of selected) {
      let blob: Blob;
      try {
        blob = await fetchAssetBlob(asset.url);
      } catch {
        continue;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = asset.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  }
}
