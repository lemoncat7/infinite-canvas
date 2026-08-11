import { ComicStudioFeature } from "./comic-studio-feature";
import { PromptAgentFeature } from "./prompt-agent-feature";

type PromptOptions = ConstructorParameters<typeof PromptAgentFeature>[0];
type ComicOptions = ConstructorParameters<typeof ComicStudioFeature>[0];

export class CanvasCreationSuiteFeature {
  readonly prompt: PromptAgentFeature;
  readonly comic: ComicStudioFeature;

  constructor(options: {
    prompt: Omit<PromptOptions, "onComic">;
    comic: Omit<
      ComicOptions,
      "promptPanel" | "getSelectedContexts" | "closePromptAgent" | "applyPlan"
    >;
  }) {
    this.prompt = new PromptAgentFeature({
      ...options.prompt,
      onComic: () => this.comic.open(),
    });
    this.comic = new ComicStudioFeature({
      ...options.comic,
      promptPanel: this.prompt.panel,
      getSelectedContexts: () => this.prompt.selectedNodes(),
      closePromptAgent: () => this.prompt.close(),
      applyPlan: (result) => this.prompt.application.applyPlan(result),
    });
  }
}
