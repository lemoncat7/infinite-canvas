import type { FlowNode } from "../nodes/node-types";
import { CanvasGenerationFeature } from "./canvas-generation-feature";
import { GenerationPoller } from "./generation-poller";
import { GenerationWorkflow } from "./generation-workflow";
import type { GenerationJob } from "./generation";

type GenerationOptions = ConstructorParameters<typeof CanvasGenerationFeature>[0];

export class CanvasGenerationRuntimeFeature {
  private readonly generation: CanvasGenerationFeature;
  private readonly poller: GenerationPoller;
  private readonly workflow: GenerationWorkflow;

  constructor(options: {
    generation: Omit<GenerationOptions, "pollJob" | "runWorkflow">;
    canGenerate: (node: FlowNode) => boolean;
    onProgress: (node: FlowNode, job: GenerationJob, changed: boolean) => void;
    onRetry: (node: FlowNode) => void;
    onSyncFailure: (failures: number, notify: boolean) => void;
  }) {
    const generationOptions = options.generation;
    this.poller = new GenerationPoller({
      nodes: generationOptions.nodes,
      onProgress: options.onProgress,
      onRetry: options.onRetry,
      onTerminal: (node, job) => this.generation.finalize(node, job),
      onSyncFailure: options.onSyncFailure,
    });
    this.workflow = new GenerationWorkflow({
      nodes: generationOptions.nodes,
      links: generationOptions.links,
      generate: (node) => this.generation.generate(node),
      save: generationOptions.save,
      draw: generationOptions.draw,
      canGenerate: options.canGenerate,
    });
    this.generation = new CanvasGenerationFeature({
      ...generationOptions,
      pollJob: this.poller.poll,
      runWorkflow: this.workflow.run,
    });
  }

  generate = (source?: FlowNode) => this.generation.generate(source);
  run = this.workflowRun.bind(this);
  poll = (node: FlowNode) => this.poller.poll(node);
  cancel = (jobId: string) => this.poller.cancel(jobId);
  cancelAll = () => this.poller.cancelAll();
  enqueue = (ids: Set<number>) => this.workflow.enqueue(ids);

  private workflowRun() { this.workflow.run(); }
}
