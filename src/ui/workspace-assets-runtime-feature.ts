import type { FlowNode, Point } from "../nodes/node-types";
import { createProjectDialog } from "./dialogs/project-dialog";
import { WorkspaceAssetsFeature } from "./workspace-assets-feature";

type AssetOptions = ConstructorParameters<typeof WorkspaceAssetsFeature>[0];
type Ask = AssetOptions["ask"];

export class WorkspaceAssetsRuntimeFeature {
  readonly assets: WorkspaceAssetsFeature;
  private readonly projectDialog: Ask;

  constructor(options: Omit<AssetOptions, "ask">) {
    this.projectDialog = createProjectDialog(
      document.querySelector<HTMLElement>("#project-dialog")!,
    );
    this.assets = new WorkspaceAssetsFeature({
      ...options,
      ask: this.projectDialog,
    });
  }

  ask: Ask = (options) => this.projectDialog(options);
  openUploadAt = (position: Point | null = null) => this.assets.openUploadAt(position);
  beginNodeUpload = (nodeId: number) => this.assets.beginNodeUpload(nodeId);
  beginNodeLibrary = (nodeId: number) => this.assets.beginNodeLibrary(nodeId);
  load = (render = true) => this.assets.loadAssets(render);
  render = () => this.assets.renderAssets();
  openPreview = (url: string, name: string, kind: "image" | "video" = "image") =>
    this.assets.openPreview(url, name, kind);
  closePreview = () => this.assets.closePreview();
  get isPreviewOpen() { return this.assets.isPreviewOpen; }
  closeContextIfOutside = (target: Node) => this.assets.closeContextIfOutside(target);
  downloadNodeImage = (node: FlowNode) => this.assets.downloadNodeImage(node);
}
