import { CreditLabController } from "./credit-lab-controller";
import { CustomApiController, type CustomApiModel } from "./custom-api-controller";
import { FeedbackController } from "./feedback-controller";
import type { AuthUser } from "./user-menu-controller";
import { clearCatalog, loadModelCatalog } from '../models/catalog';
import type { AdminModelController } from '../models/admin-controller';

type Tone = "success" | "warning" | "error" | "info";

export class AccountToolsFeature {
  private apiModels: CustomApiModel[] = [];
  private readonly customApi: CustomApiController;
  private admin?: AdminModelController;
  private readonly adminButton = document.createElement('button');

  constructor(private readonly options: {
    getUser: () => AuthUser | null;
    setUser: (user: AuthUser) => void;
    getProjectId: () => string;
    closeUserMenu: () => void;
    onCreditsChanged: () => void;
    refreshNodeModels: () => void;
    toast: (message: string, type: Tone) => void;
  }) {
    this.adminButton.type = 'button'; this.adminButton.id = 'open-global-models'; this.adminButton.hidden = true;
    this.adminButton.innerHTML = '<span aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 15h8M10 7v4M14 13v4"/></svg></span><b>全局模型</b><small>管理员</small>';
    document.querySelector('#workspace-logout')!.before(this.adminButton);
    this.adminButton.addEventListener('click', async () => {
      if (!options.getUser()?.isAdmin) return;
      this.admin ||= new (await import('../models/admin-controller')).AdminModelController({ isAdmin: () => !!options.getUser()?.isAdmin, closeUserMenu: options.closeUserMenu });
      await this.admin.open();
    });
    let pendingModelRefresh = false;
    const refreshMenus = () => {
      if (!pendingModelRefresh || document.activeElement?.closest('.flow-node')) return;
      pendingModelRefresh = false;
      options.refreshNodeModels();
    };
    document.addEventListener('model-catalog-updated', () => { pendingModelRefresh = true; refreshMenus(); });
    document.addEventListener('focusout', () => { if (pendingModelRefresh) queueMicrotask(refreshMenus); });
    const refresh = () => { if (options.getUser() && document.visibilityState === 'visible') void loadModelCatalog().catch(() => {}); };
    window.addEventListener('focus', refresh);
    setInterval(refresh, 60_000);
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
  syncUser() {
    this.adminButton.hidden = !this.options.getUser()?.isAdmin;
    if (!this.options.getUser()) { this.admin?.close(); clearCatalog(); }
  }
  async loadModels() {
    this.syncUser();
    await Promise.all([this.customApi.load(), loadModelCatalog().catch(() => this.options.toast('模型目录加载失败，请刷新重试', 'warning'))]);
  }
}
