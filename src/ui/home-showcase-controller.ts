import { apiFetch } from "../services/api";
import { mediaThumbnailUrl } from "../canvas/node-media-renderer";

type ShowcaseAsset = {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  author: string;
  url: string;
  thumbnailUrl?: string;
};

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export class HomeShowcaseController {
  loaded = false;

  constructor(
    private readonly gallery: HTMLElement,
    private readonly preview: HTMLElement,
  ) {
    preview.querySelector(":scope > button")!.addEventListener("click", () => this.close());
    preview.addEventListener("click", (event) => {
      if (event.target === preview) this.close();
    });
  }

  invalidate() {
    this.loaded = false;
  }

  async load() {
    this.loaded = true;
    try {
      const response = await apiFetch("/api/showcase");
      if (!response.ok) throw new Error(String(response.status));
      const assets = await response.json() as ShowcaseAsset[];
      if (!assets.length) return;
      this.gallery.innerHTML = "";
      assets.forEach((asset) => this.gallery.append(this.card(asset)));
    } catch {
      this.gallery.innerHTML = '<div class="home-gallery-empty"><i>◇</i><b>作品暂时无法加载</b><span>稍后刷新页面再试</span></div>';
    }
  }

  private card(asset: ShowcaseAsset) {
    const video = asset.mimeType.startsWith("video/");
    const card = document.createElement("article");
    card.className = "home-gallery-card";
    card.tabIndex = 0;
    card.innerHTML = `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"><i>${video ? "▶" : "⌕"}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || "Flow 创作者")}</small></footer>`;
    const open = () => this.open(asset);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open();
    });
    return card;
  }

  private open(asset: ShowcaseAsset) {
    const image = this.preview.querySelector<HTMLImageElement>("img")!;
    const video = this.preview.querySelector<HTMLVideoElement>("video")!;
    const isVideo = asset.mimeType.startsWith("video/");
    image.hidden = isVideo;
    video.hidden = !isVideo;
    if (isVideo) {
      video.src = asset.url;
      void video.play().catch(() => {});
    } else {
      image.src = asset.url;
      image.alt = asset.name;
    }
    this.preview.querySelector<HTMLElement>("strong")!.textContent = asset.name;
    this.preview.querySelector<HTMLElement>("footer span")!.textContent = asset.author || "Flow 创作者";
    this.preview.classList.add("open");
  }

  close() {
    const video = this.preview.querySelector<HTMLVideoElement>("video")!;
    video.pause();
    video.removeAttribute("src");
    this.preview.querySelector<HTMLImageElement>("img")!.removeAttribute("src");
    this.preview.classList.remove("open");
  }
}
