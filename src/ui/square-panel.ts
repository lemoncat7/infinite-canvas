import type { SquareAsset } from "../services/assets";

type SquarePanelOptions = {
  grid: HTMLElement;
  count: HTMLElement;
  search: HTMLInputElement;
  pageSize: number;
  onOpen: (asset: SquareAsset, kind: "image" | "video") => void;
};

export class SquarePanelView {
  private assets: SquareAsset[] = [];
  private page = 0;

  constructor(private readonly options: SquarePanelOptions) {
    options.search.addEventListener("input", () => {
      this.page = 0;
      this.render();
    });
  }

  setLoading(loading: boolean) {
    this.options.grid.classList.toggle("loading", loading);
  }

  setAssets(assets: SquareAsset[]) {
    this.assets = assets;
    this.page = 0;
    this.render();
  }

  showLoadError() {
    this.options.grid.innerHTML =
      '<div class="asset-empty"><b>◇</b><span>作品暂时无法加载</span><small>稍后再试</small></div>';
  }

  private render() {
    const query = this.options.search.value.trim().toLocaleLowerCase();
    const assets = this.assets.filter((asset) =>
      `${asset.name} ${asset.author}`.toLocaleLowerCase().includes(query),
    );
    const pageCount = Math.max(
      1,
      Math.ceil(assets.length / this.options.pageSize),
    );
    this.page = Math.min(this.page, pageCount - 1);
    const pageAssets = assets.slice(
      this.page * this.options.pageSize,
      (this.page + 1) * this.options.pageSize,
    );
    this.options.count.textContent = `${assets.length} 项`;
    this.options.grid.innerHTML = assets.length
      ? ""
      : '<div class="asset-empty"><b>◇</b><span>没有找到作品</span><small>换个关键词试试</small></div>';
    for (const asset of pageAssets) this.options.grid.append(this.card(asset));
    if (assets.length > this.options.pageSize)
      this.options.grid.append(this.pager(pageCount));
  }

  private card(asset: SquareAsset) {
    const video = asset.mimeType.startsWith("video/");
    const card = document.createElement("article");
    card.className = "square-card";
    card.tabIndex = 0;
    card.innerHTML = `<img src="${asset.thumbnailUrl || thumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"><i>${video ? "▶" : "⌕"}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || "Viora 创作者")}</small></footer>`;
    const open = () => this.options.onOpen(asset, video ? "video" : "image");
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open();
    });
    return card;
  }

  private pager(pageCount: number) {
    const pager = document.createElement("nav");
    pager.className = "asset-pager square-pager";
    pager.innerHTML = `<button type="button" data-square-page="prev" ${this.page === 0 ? "disabled" : ""}>上一页</button><span>${this.page + 1} / ${pageCount}</span><button type="button" data-square-page="next" ${this.page >= pageCount - 1 ? "disabled" : ""}>下一页</button>`;
    pager.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.addEventListener("click", () => {
        this.page += button.dataset.squarePage === "next" ? 1 : -1;
        this.options.grid.scrollTop = 0;
        this.render();
      });
    });
    return pager;
  }
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
