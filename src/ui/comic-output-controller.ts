import type { FlowNode } from "../nodes/node-types";
import type { PromptAgentResult } from "../nodes/comic-types";
import { buildComicWorkflow } from "../nodes/comic-workflow";
import { formatComicPlan } from "../nodes/comic-format";
import type { ComicSessionState } from "../services/comic-session-state";

export type ComicWorkflowStats = {
  characterCount: number;
  propCount: number;
  storyboardCount: number;
  compositeCount: number;
  sceneCount: number;
};

type ComicOutputControllerOptions = {
  state: ComicSessionState;
  getNodes: () => FlowNode[];
  prepareCanvas: () => void;
  applyPlan: (result: PromptAgentResult) => void;
  closeStudio: () => void;
  onWorkflowReady: (stats: ComicWorkflowStats) => void;
  onWorkflowError: (message: string, shotCount: number, nodeCount: number) => void;
  createLabel: () => FlowNode | undefined;
  renderLabelState: () => void;
  persistCanvas: () => void;
  draw: () => void;
  showSaved: (copy: boolean) => void;
};

export class ComicOutputController {
  constructor(private readonly options: ComicOutputControllerOptions) {}

  applyToCanvas() {
    const plan = this.options.state.plan;
    if (!plan) return;
    this.options.prepareCanvas();
    try {
      const { result, storyboardCount, compositeCount, sceneCount } = buildComicWorkflow(plan);
      this.options.applyPlan(result);
      this.options.closeStudio();
      this.options.onWorkflowReady({
        characterCount: plan.characters.length,
        propCount: plan.props?.length || 0,
        storyboardCount,
        compositeCount,
        sceneCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      this.options.onWorkflowError(message, plan.shots.length, this.options.getNodes().length);
    }
  }

  saveAsLabel(copy = false) {
    const { state } = this.options;
    if (!state.plan) return;
    let label = !copy
      ? this.options.getNodes().find((node) => node.id === state.linkedLabelId)
      : undefined;
    if (!label) label = this.options.createLabel();
    if (!label) return;
    label.title = `漫剧方案 · ${state.plan.title}`;
    label.body = formatComicPlan(state.plan);
    label.comicData = structuredClone(state.plan);
    label.width = 440;
    label.height = 560;
    label.fontScale = 0.92;
    state.linkedLabelId = label.id;
    this.options.renderLabelState();
    this.options.persistCanvas();
    this.options.draw();
    this.options.showSaved(copy);
  }
}
