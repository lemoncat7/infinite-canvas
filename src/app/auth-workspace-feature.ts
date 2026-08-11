import type { FlowLink, FlowNode } from "../nodes/node-types";
import { SessionActivityController } from "../services/session-activity";
import { AuthModalController } from "../ui/auth-modal-controller";
import { HomeSceneController } from "../ui/home-scene-controller";
import { HomeShowcaseController } from "../ui/home-showcase-controller";
import { UserMenuController, type AuthUser } from "../ui/user-menu-controller";
import { WorkspaceRouteController } from "./workspace-route-controller";
import { WorkspaceSessionController } from "./workspace-session-controller";

type NoticeTone = "success" | "warning" | "error";

export class AuthWorkspaceFeature {
  private currentUser: AuthUser | null = null;
  private ready = false;
  private readonly showcase: HomeShowcaseController;
  private readonly activity: SessionActivityController;
  private readonly authModal: AuthModalController;
  private readonly route: WorkspaceRouteController;
  private readonly session: WorkspaceSessionController;
  readonly userMenu: UserMenuController;

  constructor(options: {
    nodes: FlowNode[];
    links: FlowLink[];
    getProjectId: () => string;
    setProjectId: (id: string) => void;
    getLoadedProjectId: () => string;
    isSaveBlocked: () => boolean;
    getServerVersion: () => number;
    ensureRenderer: () => Promise<void>;
    stopSave: (logout?: boolean) => Promise<void>;
    resetNodeLease: () => void;
    loadCanvas: (keepStatus: boolean) => Promise<unknown>;
    loadAssets: () => Promise<unknown>;
    loadModels: () => Promise<unknown>;
    apiFetch: typeof fetch;
    resize: () => void;
    clearSelection: () => void;
    registerUserMenu: (close: () => void) => void;
    closeTopbarMenus: (opening?: boolean) => void;
    onUserRendered: (user: AuthUser | null) => void;
    notify: (message: string, type: NoticeTone, detail?: string) => void;
  }) {
    const homePage = document.querySelector<HTMLElement>("#home-page")!;
    const loginModal = document.querySelector<HTMLElement>("#home-login-modal")!;
    const preview = document.querySelector<HTMLElement>("#home-preview")!;
    this.showcase = new HomeShowcaseController(
      document.querySelector<HTMLElement>("#home-gallery")!,
      preview,
      document.querySelector<HTMLElement>(".home-showcase")!,
    );
    this.activity = new SessionActivityController({
      isAuthenticated: () => Boolean(this.currentUser),
      logout: (message) => this.logout(message),
    });
    this.authModal = new AuthModalController({
      modal: loginModal,
      onAuthenticated: async (user, completedMode) => {
        this.currentUser = user;
        this.ready = true;
        this.activity.touch();
        this.renderUser();
        if (!(await this.synchronize()))
          throw new Error("登录成功，但画布未能完整同步，请重试");
        if (completedMode === "register") {
          location.hash = "#/canvas";
          await Promise.all([options.loadAssets(), options.loadModels()]);
          this.applyRoute();
        } else options.notify(`欢迎回来，${user.name}`, "success");
      },
    });
    this.route = new WorkspaceRouteController({
      homePage,
      authenticated: () => Boolean(this.currentUser),
      authReady: () => this.ready,
      showcaseLoaded: () => this.showcase.loaded,
      loadShowcase: () => this.showcase.load(),
      enterWorkspace: () => { void this.enter(); },
      openAuth: (mode) => this.authModal.open(mode),
      resize: options.resize,
    });
    const menu = document.querySelector<HTMLElement>("#workspace-user-menu")!;
    options.registerUserMenu(() => menu.classList.remove("open"));
    this.userMenu = new UserMenuController({
      menu,
      button: document.querySelector<HTMLButtonElement>("#workspace-user")!,
      homeLogin: document.querySelector<HTMLButtonElement>("#home-login")!,
      homeEnter: document.querySelector<HTMLButtonElement>("#home-enter")!,
      logoutButton: document.querySelector<HTMLElement>("#workspace-logout")!,
      inviteCopyButton: document.querySelector<HTMLButtonElement>("#copy-invite-code")!,
      getUser: () => this.currentUser,
      setUser: (user) => { this.currentUser = user; },
      closeTopbarMenus: options.closeTopbarMenus,
      logout: () => this.logout(),
      toast: options.notify,
    });
    this.session = new WorkspaceSessionController({
      nodes: options.nodes,
      links: options.links,
      authenticated: () => Boolean(this.currentUser),
      currentProjectId: options.getProjectId,
      setCurrentProjectId: options.setProjectId,
      loginMode: () => this.authModal.mode,
      loadedProjectId: options.getLoadedProjectId,
      saveBlocked: options.isSaveBlocked,
      serverVersion: options.getServerVersion,
      ensureRenderer: options.ensureRenderer,
      stopSave: options.stopSave,
      resetNodeLease: options.resetNodeLease,
      loadCanvas: options.loadCanvas,
      loadAssets: options.loadAssets,
      loadModels: options.loadModels,
      apiFetch: options.apiFetch,
      status: (message) => this.status(message),
      hideStatus: (version, delay) => this.hideStatus(version, delay),
      applyRoute: () => this.applyRoute(),
      clearSelection: options.clearSelection,
      clearToken: () => this.userMenu.clearToken(),
      closeUserMenu: () => this.userMenu.close(),
      renderUser: () => this.renderUser(),
      clearUser: () => { this.currentUser = null; },
      notify: options.notify,
    });
    this.route.bind();
    new HomeSceneController(homePage, loginModal, preview);
    this.renderCallback = options.onUserRendered;
  }

  private renderCallback: (user: AuthUser | null) => void;
  get user() { return this.currentUser; }
  setUser(user: AuthUser | null) { this.currentUser = user; }
  markReady() { this.ready = true; }
  touch() { this.activity.touch(); }
  invalidateShowcase() { this.showcase.invalidate(); }
  renderUser() { this.userMenu.render(this.currentUser); this.renderCallback(this.currentUser); }
  ensureCurrentProject() { return this.session.ensureCurrentProject(); }
  synchronize(force = false) { return this.session.synchronize(force); }
  enter() { return this.session.enter(); }
  logout(message?: string) { return this.session.logout(message); }
  status(message: string, visible = true) { return this.route.status(message, visible); }
  hideStatus(version: number, delay: number) { this.route.hideStatus(version, delay); }
  applyRoute() { this.route.apply(); }
  randomizeTheme = () => this.route.randomizeTheme();
}
