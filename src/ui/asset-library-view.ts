import type { LibraryAsset } from "../services/assets";
import { formatFileSize } from "./asset-panel";

type AssetKind = "image" | "video" | "audio";

type AssetLibraryViewOptions = {
  grid: HTMLElement;
  count: HTMLElement;
  pageSize: number;
  selectedIds: Set<string>;
  bulkDelete: HTMLButtonElement;
  bulkDownload: HTMLButtonElement;
  isTouchContextBlocked: () => boolean;
  onOpen: (asset: LibraryAsset, kind: "image" | "video") => void;
  onAudio: (asset: LibraryAsset) => void;
  onPickImage: (asset: LibraryAsset) => void;
  onContext: (asset: LibraryAsset, x: number, y: number) => void;
};

export class AssetLibraryView {
  private page = 0;
  private view: "grid" | "list" = "grid";
  private assets: LibraryAsset[] = [];
  private picking = false;
  private playingAudioId = "";

  constructor(private readonly options: AssetLibraryViewOptions) {}

  resetPage() {
    this.page = 0;
  }

  setView(view: "grid" | "list") {
    this.view = view;
  }

  render(
    assets: LibraryAsset[],
    state: { picking: boolean; playingAudioId?: string },
  ) {
    this.assets = assets;
    this.picking = state.picking;
    this.playingAudioId = state.playingAudioId || "";
    const pageCount = Math.max(
      1,
      Math.ceil(assets.length / this.options.pageSize),
    );
    this.page = Math.min(this.page, pageCount - 1);
    const pageAssets = assets.slice(
      this.page * this.options.pageSize,
      (this.page + 1) * this.options.pageSize,
    );
    this.options.count.textContent = this.picking
      ? `${assets.length} 张图片 · 点击复用到节点`
      : `${assets.length} 项${this.options.selectedIds.size ? ` · 已选 ${this.options.selectedIds.size}` : ""}`;
    this.options.grid.className = `asset-grid ${this.view === "list" ? "is-list" : ""}${this.picking ? " is-picking" : ""}`;
    this.options.grid.innerHTML = assets.length
      ? ""
      : '<div class="asset-empty"><b>◇</b><span>没有匹配的素材</span><small>尝试调整项目范围、类型或关键词</small></div>';
    pageAssets.forEach((asset) => this.options.grid.append(this.card(asset)));
    if (assets.length > this.options.pageSize)
      this.options.grid.append(this.pager(pageCount));
    const disabled = this.options.selectedIds.size === 0;
    this.options.bulkDelete.disabled = disabled;
    this.options.bulkDownload.disabled = disabled;
  }

  private card(asset: LibraryAsset) {
    const kind = assetKind(asset);
    const selected = this.options.selectedIds.has(asset.id);
    const item = document.createElement("article");
    item.className = `asset-item${asset.isPublic ? " is-public" : ""}${selected ? " selected" : ""}`;
    item.dataset.assetId = asset.id;
    item.innerHTML =
      kind === "audio"
        ? `<div class="asset-audio-cover"><span>${this.playingAudioId === asset.id ? "Ⅱ" : "♪"}</span><small>音频预览</small></div><i class="asset-kind-indicator">AUDIO</i><button class="asset-select" type="button" aria-label="选择资产">${selected ? "✓" : ""}</button><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.projectName || "当前项目")} · ${formatFileSize(asset.size)}</small></footer>`
        : `<img src="${asset.thumbnailUrl || thumbnailUrl(asset.url)}" alt="" draggable="false" loading="lazy" decoding="async"><i class="asset-kind-indicator">${kind === "video" ? "▶" : ""}</i><button class="asset-select" type="button" aria-label="选择资产">${selected ? "✓" : ""}</button><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.projectName || "当前项目")} · ${formatFileSize(asset.size)}</small></footer>`;
    item.draggable = false;
    item.title = this.picking
      ? "单击复用到当前图片节点"
      : "单击查看 · 长按或右击更多操作";
    item
      .querySelector<HTMLButtonElement>(".asset-select")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        if (selected) this.options.selectedIds.delete(asset.id);
        else this.options.selectedIds.add(asset.id);
        this.render(this.assets, {
          picking: this.picking,
          playingAudioId: this.playingAudioId,
        });
      });
    item.addEventListener("click", () => {
      if (this.options.isTouchContextBlocked()) return;
      if (kind === "audio") return this.options.onAudio(asset);
      if (this.picking && kind === "image") return this.options.onPickImage(asset);
      this.options.onOpen(asset, kind);
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind === "audio") return this.options.onAudio(asset);
      this.options.onContext(asset, event.clientX, event.clientY);
    });
    return item;
  }

  private pager(pageCount: number) {
    const pager = document.createElement("nav");
    pager.className = "asset-pager";
    pager.innerHTML = `<button type="button" data-asset-page="prev" ${this.page === 0 ? "disabled" : ""}>上一页</button><span>${this.page + 1} / ${pageCount}</span><button type="button" data-asset-page="next" ${this.page >= pageCount - 1 ? "disabled" : ""}>下一页</button>`;
    pager.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.addEventListener("click", () => {
        this.page += button.dataset.assetPage === "next" ? 1 : -1;
        this.options.grid.scrollTop = 0;
        this.render(this.assets, {
          picking: this.picking,
          playingAudioId: this.playingAudioId,
        });
      });
    });
    return pager;
  }
}

function assetKind(asset: LibraryAsset): AssetKind {
  return asset.mimeType.startsWith("video/")
    ? "video"
    : asset.mimeType.startsWith("audio/")
      ? "audio"
      : "image";
}

function thumbnailUrl(url: string) {
  return url.replace(
    /^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/,
    "$1/thumbnail",
  );
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
