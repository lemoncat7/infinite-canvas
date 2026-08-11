import { fetchAssets, type LibraryAsset } from "../services/assets";
import { filterAssets } from "./asset-panel";
import type { AssetLibraryView } from "./asset-library-view";

type AssetLibraryControllerOptions = {
  search: HTMLInputElement;
  projectFilter: HTMLSelectElement;
  typeFilter: HTMLSelectElement;
  sort: HTMLSelectElement;
  viewButtons: NodeListOf<HTMLButtonElement>;
  getCurrentProjectId: () => string;
  getView: () => AssetLibraryView;
  showError: (message: string) => void;
};

export class AssetLibraryController {
  private assets: LibraryAsset[] = [];
  private imageTargetId: number | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioAssetId = "";

  constructor(private readonly options: AssetLibraryControllerOptions) {
    this.bindControls();
  }

  get hasAssets() { return this.assets.length > 0; }
  get allAssets() { return this.assets; }
  get isPickingImage() { return this.imageTargetId !== null; }

  setImageTarget(nodeId: number | null) {
    this.imageTargetId = nodeId;
  }

  consumeImageTarget() {
    const id = this.imageTargetId;
    this.imageTargetId = null;
    return id;
  }

  resolveItem(item: HTMLElement) {
    return this.assets.find((asset) => asset.id === item.dataset.assetId);
  }

  async load(render = true) {
    try {
      this.assets = await fetchAssets();
      if (render) this.render();
    } catch {
      // Keep the last successful asset snapshot until the next refresh.
    }
  }

  render() {
    this.options.getView().render(this.visibleAssets(), {
      picking: this.isPickingImage,
      playingAudioId: this.audio && !this.audio.paused ? this.audioAssetId : "",
    });
  }

  playAudio(asset: LibraryAsset) {
    if (this.audio && this.audioAssetId === asset.id) {
      if (this.audio.paused) void this.audio.play();
      else this.audio.pause();
      return;
    }
    this.audio?.pause();
    this.audio = new Audio(asset.url);
    this.audioAssetId = asset.id;
    this.audio.onended = () => {
      this.audioAssetId = "";
      this.render();
    };
    void this.audio.play().then(() => this.render()).catch(() => this.options.showError("音频预览失败"));
  }

  private visibleAssets() {
    return filterAssets(this.assets, {
      query: this.options.search.value,
      scope: this.options.projectFilter.value,
      type: this.isPickingImage ? "image" : this.options.typeFilter.value,
      sort: this.options.sort.value,
      currentProjectId: this.options.getCurrentProjectId(),
    });
  }

  private bindControls() {
    [this.options.search, this.options.projectFilter, this.options.typeFilter, this.options.sort].forEach((control) =>
      control.addEventListener("input", () => {
        this.options.getView().resetPage();
        this.render();
      }),
    );
    this.options.viewButtons.forEach((button) =>
      button.addEventListener("click", () => {
        this.options.getView().setView(button.dataset.assetView as "grid" | "list");
        this.options.viewButtons.forEach((item) => item.classList.toggle("active", item === button));
        this.render();
      }),
    );
  }
}
