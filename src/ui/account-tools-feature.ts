import { CreditLabController } from "./credit-lab-controller";
import { CustomApiController, type CustomApiModel } from "./custom-api-controller";
import { FeedbackController } from "./feedback-controller";
import type { AuthUser } from "./user-menu-controller";

type Tone = "success" | "warning" | "error" | "info";

export class AccountToolsFeature {
  private apiModels: CustomApiModel[] = [];
  private readonly customApi: CustomApiController;

  constructor(options: {
    getUser: () => AuthUser | null;
    setUser: (user: AuthUser) => void;
    getProjectId: () => string;
    closeUserMenu: () => void;
    onCreditsChanged: () => void;
    refreshNodeModels: () => void;
    toast: (message: string, type: Tone) => void;
  }) {
    const feedbackModal = document.querySelector<HTMLElement>("#feedback-modal")!;
    new FeedbackController({
      modal: feedbackModal,
      form: feedbackModal.querySelector<HTMLFormElement>("#feedback-form")!,
      openButton: document.querySelector<HTMLElement>("#open-feedback")!,
      closeUserMenu: options.closeUserMenu,
      getProjectId: options.getProjectId,
      toast: options.toast,
    });
    new CreditLabController({
      modal: document.querySelector<HTMLElement>("#lab-modal")!,
      openButton: document.querySelector<HTMLElement>("#open-lab")!,
      getUser: options.getUser,
      setUser: options.setUser,
      closeUserMenu: options.closeUserMenu,
      onCreditsChanged: options.onCreditsChanged,
      toast: options.toast,
    });
    this.customApi = new CustomApiController({
      modal: document.querySelector<HTMLElement>("#custom-api-modal")!,
      form: document.querySelector<HTMLFormElement>("#custom-api-form")!,
      list: document.querySelector<HTMLElement>("#custom-api-list")!,
      openButton: document.querySelector<HTMLButtonElement>("#open-custom-api")!,
      getModels: () => this.apiModels,
      setModels: (models) => { this.apiModels = models; },
      closeUserMenu: options.closeUserMenu,
      refreshNodeModels: options.refreshNodeModels,
    });
  }

  get models() { return this.apiModels; }
  loadModels() { return this.customApi.load(); }
}
