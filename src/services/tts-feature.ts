import type { FlowLink, FlowNode } from "../nodes/node-types";
import { TtsGenerationController } from "../nodes/tts-generation-controller";
import { TtsCatalogController } from "./tts-catalog";

type Tone = "success" | "warning" | "error" | "info";

export class TtsFeature {
  readonly catalog: TtsCatalogController;
  private readonly generation: TtsGenerationController;

  constructor(options: {
    nodes: FlowNode[];
    links: FlowLink[];
    getProjectId: () => string;
    allocateNodeId: () => number | null;
    invalidateProviders: () => void;
    invalidateVoices: (providerId: string) => void;
    updateEditor: () => void;
    draw: () => void;
    save: () => void;
    reloadAssets: () => void | Promise<void>;
    toast: (message: string, tone: Tone) => void;
  }) {
    this.catalog = new TtsCatalogController({
      invalidateProviders: options.invalidateProviders,
      invalidateVoices: options.invalidateVoices,
    });
    this.generation = new TtsGenerationController({
      nodes: options.nodes,
      links: options.links,
      getProjectId: options.getProjectId,
      allocateNodeId: options.allocateNodeId,
      updateEditor: options.updateEditor,
      draw: options.draw,
      save: options.save,
      reloadAssets: options.reloadAssets,
      toast: options.toast,
    });
  }

  loadProviders() { return this.catalog.loadProviders(); }
  loadVoices(providerId = "easyvoice-local") { return this.catalog.loadVoices(providerId); }
  connectedVoice(node: FlowNode) { return this.generation.connectedVoice(node); }
  preview(node: FlowNode) { return this.generation.preview(node); }
  generate(node: FlowNode) { return this.generation.generate(node); }
}
