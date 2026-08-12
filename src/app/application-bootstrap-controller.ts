export class ApplicationBootstrapController<User> {
  constructor(private readonly options: {
    apiFetch: typeof fetch;
    setUser: (user: User | null) => void;
    user: () => User | null;
    setReady: () => void;
    renderUser: () => void;
    touchSession: () => void;
    loadCapabilities: () => Promise<unknown>;
    synchronizeCanvas: () => Promise<boolean>;
    loadAssets: () => Promise<unknown>;
    status: (message: string, visible?: boolean) => number;
    randomizeTheme: () => void;
    applyRoute: () => void;
    notifyError: (message: string) => void;
  }) {}

  async run() {
    this.options.status("正在检测登录状态");
    try {
      const response = await this.options.apiFetch("/api/users/me");
      this.options.setUser(response.ok ? await response.json() as User : null);
    } catch {
      this.options.setUser(null);
    }
    this.options.setReady();
    localStorage.removeItem("flow-authenticated");
    this.options.renderUser();
    if (this.options.user()) this.options.touchSession();
    if (this.options.user() && location.hash === "#/canvas") {
      document.body.classList.add("home-mode", "workspace-loading", "workspace-preparing");
      this.options.randomizeTheme();
      this.options.status("登录成功，正在同步项目");
      const restored = await this.options.synchronizeCanvas();
      if (restored) {
        this.options.status("正在加载资产索引与创作模型");
        await Promise.all([
          this.options.loadAssets(),
          this.options.loadCapabilities(),
        ]);
        this.options.status("工作区已准备完成");
      } else {
        location.hash = "#/";
        this.options.notifyError("工作区同步失败，请重新进入创作");
      }
      document.body.classList.remove("workspace-loading", "workspace-preparing");
    } else if (this.options.user()) await this.options.loadCapabilities();
    this.options.status("", false);
    this.options.applyRoute();
  }
}
