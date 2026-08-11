import type { Point } from "../nodes/node-types";
import { uploadProjectImages, type UploadedAsset } from "../services/assets";

type AssetUploadControllerOptions = {
  input: HTMLInputElement;
  nodeInput: HTMLInputElement;
  button: HTMLButtonElement;
  triggers: HTMLElement[];
  getProjectId: () => string;
  getPastePosition: () => Point;
  onAttachNode: (nodeId: number, asset: UploadedAsset) => void;
  onPlace: (position: Point, asset: UploadedAsset) => void;
  onReload: () => void | Promise<void>;
  onToast: (
    message: string,
    tone: "success" | "warning" | "error",
    detail?: string,
  ) => void;
};

export class AssetUploadController {
  private placement: Point | null = null;
  private targetNodeId: number | null = null;
  private busy = false;

  constructor(private readonly options: AssetUploadControllerOptions) {
    options.input.accept = "image/*";
    options.input.multiple = true;
    options.nodeInput.accept = "image/*";
    options.nodeInput.hidden = true;
    options.input.addEventListener("change", () => {
      const files = [...(options.input.files ?? [])];
      const placement = this.placement;
      this.placement = null;
      if (files.length) void this.upload(files, { placement });
    });
    options.nodeInput.addEventListener("change", () => {
      const files = [...(options.nodeInput.files ?? [])];
      const targetNodeId = this.targetNodeId;
      this.targetNodeId = null;
      if (files.length && targetNodeId !== null)
        void this.upload(files, { targetNodeId });
    });
    options.triggers.forEach((trigger) =>
      trigger.addEventListener("click", () => this.open()),
    );
    window.addEventListener("paste", this.onPaste);
  }

  open(placement: Point | null = null) {
    if (this.busy) {
      this.options.onToast("图片正在上传，请稍候", "warning");
      return;
    }
    this.placement = placement;
    this.options.input.value = "";
    this.options.input.click();
  }

  openForNode(nodeId: number) {
    if (this.busy) {
      this.options.onToast("图片正在上传，请稍候", "warning");
      return;
    }
    this.targetNodeId = nodeId;
    this.options.nodeInput.value = "";
    this.options.nodeInput.click();
  }

  private async upload(
    files: File[],
    target: { placement?: Point | null; targetNodeId?: number; pasted?: boolean },
  ) {
    if (this.busy) {
      this.options.onToast("图片正在上传，请稍候", "warning");
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      this.options.onToast("仅支持上传图片", "warning");
      return;
    }
    this.busy = true;
    this.options.button.disabled = true;
    this.options.button.textContent = "正在上传…";
    try {
      const uploaded = await uploadProjectImages(
        this.options.getProjectId(),
        images,
      );
      const first = uploaded[0];
      if (first && target.targetNodeId !== undefined)
        this.options.onAttachNode(target.targetNodeId, first);
      else if (first && target.placement)
        this.options.onPlace(target.placement, first);
      await this.options.onReload();
      if (target.pasted)
        this.options.onToast("图片已粘贴到画布中心", "success");
    } catch (error) {
      this.options.onToast(
        "图片上传失败",
        "error",
        error instanceof Error ? error.message : "请重试",
      );
    } finally {
      this.busy = false;
      this.options.button.disabled = false;
      this.options.button.textContent = "↑ 上传图片";
      this.options.input.value = "";
      this.options.nodeInput.value = "";
    }
  }

  private readonly onPaste = (event: ClipboardEvent) => {
    const image = [...(event.clipboardData?.items ?? [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const namedImage = image.name
      ? image
      : new File(
          [image],
          `粘贴图片-${Date.now()}.${image.type.split("/")[1] || "png"}`,
          { type: image.type },
        );
    void this.upload([namedImage], {
      placement: this.options.getPastePosition(),
      pasted: true,
    });
  };
}
