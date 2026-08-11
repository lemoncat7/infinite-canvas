import type { FlowLink, FlowNode } from "../nodes/node-types";

export class WorkspaceSessionController {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    authenticated: () => boolean;
    currentProjectId: () => string;
    setCurrentProjectId: (id: string) => void;
    loginMode: () => string;
    loadedProjectId: () => string;
    saveBlocked: () => boolean;
    serverVersion: () => number;
    ensureRenderer: () => Promise<void>;
    stopSave: (logout?: boolean) => Promise<void>;
    resetNodeLease: () => void;
    loadCanvas: (keepStatus: boolean) => Promise<unknown>;
    loadAssets: () => Promise<unknown>;
    loadModels: () => Promise<unknown>;
    apiFetch: typeof fetch;
    status: (message: string) => number;
    hideStatus: (version: number, delay: number) => void;
    applyRoute: () => void;
    clearSelection: () => void;
    clearToken: () => void;
    closeUserMenu: () => void;
    renderUser: () => void;
    clearUser: () => void;
    notify: (message: string, type: "error" | "warning", detail?: string) => void;
  }) {}

  async ensureCurrentProject() {
    const response = await this.options.apiFetch("/api/projects");
    if (!response.ok) return false;
    const projects = await response.json() as Array<{ id: string }>;
    if (!projects.length) return false;
    if (!projects.some((project) => project.id === this.options.currentProjectId())) {
      const id = projects[0].id;
      this.options.setCurrentProjectId(id);
      localStorage.setItem("flow-project-id", id);
    }
    return true;
  }

  async synchronize(force = false) {
    if (!this.options.authenticated()) return false;
    if (!force && location.hash !== "#/canvas" && this.options.loginMode() === "login")
      return this.ensureCurrentProject();
    await this.options.ensureRenderer();
    await this.options.stopSave();
    this.options.resetNodeLease();
    this.options.status("正在同步账号与项目");
    if (!(await this.ensureCurrentProject())) return false;
    this.options.status("正在恢复画布与任务");
    await this.options.loadCanvas(true);
    return this.options.loadedProjectId() === this.options.currentProjectId()
      && !this.options.saveBlocked()
      && this.options.serverVersion() > 0;
  }

  async enter() {
    if (!this.options.authenticated()) return;
    document.body.classList.add("home-mode", "workspace-loading", "workspace-preparing");
    this.options.status("正在同步账号与项目");
    const ready = this.options.loadedProjectId() === this.options.currentProjectId()
      && !this.options.saveBlocked()
      && this.options.serverVersion() > 0;
    let finalStatus = 0;
    let completed = false;
    try {
      await this.options.ensureRenderer();
      if (!ready && !(await this.synchronize(true)))
        throw new Error("画布尚未完整同步，请检查网络后重试");
      this.options.status("正在加载资产索引与创作模型");
      await Promise.all([this.options.loadAssets(), this.options.loadModels()]);
      completed = true;
      finalStatus = this.options.status("工作区已准备完成");
    } catch (error) {
      this.options.notify(error instanceof Error ? error.message : "工作区加载失败", "error");
      finalStatus = this.options.status("工作区加载失败");
    } finally {
      if (completed) {
        location.hash = "#/canvas";
        document.body.classList.remove("workspace-preparing");
        this.options.applyRoute();
      }
      this.options.hideStatus(finalStatus, completed ? 360 : 1800);
      document.body.classList.remove("workspace-loading");
      if (!completed) document.body.classList.remove("workspace-preparing");
    }
  }

  async logout(message?: string) {
    await this.options.stopSave(true);
    await this.options.apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    this.options.clearUser();
    this.options.clearToken();
    this.options.nodes.splice(0);
    this.options.links.splice(0);
    this.options.clearSelection();
    this.options.closeUserMenu();
    this.options.renderUser();
    location.hash = "#/";
    this.options.applyRoute();
    if (message) this.options.notify(message, "warning");
  }
}
