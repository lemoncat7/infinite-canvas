export type AssetPreviewKind = "image" | "video";

type AssetPreviewOptions = {
  modal: HTMLElement;
  image: HTMLImageElement;
  video: HTMLVideoElement;
  name: HTMLElement;
  closeButton: HTMLElement;
};

export class AssetPreviewController {
  constructor(private readonly options: AssetPreviewOptions) {
    options.closeButton.addEventListener("click", () => this.close());
    options.modal.addEventListener("click", (event) => {
      if (event.target === options.modal) this.close();
    });
  }

  get isOpen() {
    return this.options.modal.classList.contains("open");
  }

  open(url: string, name: string, kind: AssetPreviewKind = "image") {
    this.releaseMedia();
    this.options.name.textContent = name;
    const video = kind === "video";
    this.options.image.hidden = video;
    this.options.video.hidden = !video;
    if (video) this.options.video.src = url;
    else {
      this.options.image.src = url;
      this.options.image.alt = name;
    }
    this.options.modal.classList.add("open");
  }

  close() {
    this.options.modal.classList.remove("open");
    this.releaseMedia();
  }

  private releaseMedia() {
    this.options.image.removeAttribute("src");
    this.options.image.alt = "";
    this.options.video.pause();
    this.options.video.removeAttribute("src");
    this.options.video.load();
  }
}
