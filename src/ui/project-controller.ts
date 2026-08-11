import {
  createProject,
  duplicateProject,
  fetchProjects,
  removeProject,
  renameProject,
  type ProjectSummary,
} from "../services/projects";
import type { ProjectDialogOptions } from "./dialogs/project-dialog";
import { renderProjectList } from "./project-panel";

type AskProjectDialog = (
  options: ProjectDialogOptions,
) => Promise<string | boolean>;

type ProjectControllerOptions = {
  list: HTMLElement;
  count: HTMLElement;
  search: HTMLInputElement;
  sort: HTMLSelectElement;
  newButton: HTMLElement;
  ask: AskProjectDialog;
  getCurrentProjectId: () => string;
  switchProject: (projectId: string) => Promise<void>;
  deleteCurrentProject: (nextProjectId: string) => Promise<void>;
  toast: (
    message: string,
    type: "success" | "error",
    detail?: string,
  ) => void;
};

export class ProjectController {
  private projects: ProjectSummary[] = [];

  constructor(private readonly options: ProjectControllerOptions) {
    if (options.sort.options[0])
      options.sort.options[0].textContent = "最近进入";
    options.newButton.addEventListener("click", () => {
      void this.create();
    });
    options.search.addEventListener("input", () => this.render());
    options.sort.addEventListener("change", () => this.render());
  }

  async load() {
    try {
      this.projects = (await fetchProjects()).map((project) => ({
        ...project,
        updatedAt: project.lastOpenedAt || project.updatedAt,
      }));
      this.render();
    } catch {
      this.options.toast("项目列表加载失败", "error");
    }
  }

  private render() {
    renderProjectList({
      list: this.options.list,
      count: this.options.count,
      projects: this.projects,
      currentProjectId: this.options.getCurrentProjectId(),
      query: this.options.search.value,
      sort: this.options.sort.value,
      onOpen: (project) => void this.options.switchProject(project.id),
      onAction: (action, project) => void this.handleAction(action, project),
    });
  }

  private async create() {
    const name = await this.options.ask({
      title: "新建项目",
      description: "给新的创作空间取一个容易识别的名称。",
      value: `未命名项目 ${this.projects.length + 1}`,
      confirm: "创建项目",
    });
    if (!name) return;
    try {
      const project = await createProject(String(name));
      await this.options.switchProject(project.id);
    } catch {
      this.options.toast("项目创建失败", "error");
    }
  }

  private async handleAction(action: string, project: ProjectSummary) {
    if (action === "rename") {
      if (!(await this.rename(project))) return;
    } else if (action === "duplicate") {
      if (!(await this.duplicate(project))) return;
    } else if (action === "delete") {
      if (!(await this.remove(project))) return;
    } else return;
    await this.load();
  }

  private async rename(project: ProjectSummary) {
    const name = await this.options.ask({
      title: "重命名项目",
      description: "项目中的画布和资产不会受到影响。",
      value: project.name,
      confirm: "保存名称",
    });
    if (!name || name === project.name) return false;
    const response = await renameProject(project.id, String(name));
    if (!response.ok) {
      this.options.toast("项目重命名失败", "error");
      return false;
    }
    this.options.toast("项目名称已更新", "success");
    return true;
  }

  private async duplicate(project: ProjectSummary) {
    const confirmed = await this.options.ask({
      title: "创建项目副本",
      description: `将复制“${project.name}”的画布和全部资产，公开状态不会复制。`,
      confirm: "创建副本",
    });
    if (!confirmed) return false;
    const response = await duplicateProject(project.id);
    if (!response.ok) {
      this.options.toast("项目复制失败", "error");
      return false;
    }
    this.options.toast("项目副本已创建", "success");
    return true;
  }

  private async remove(project: ProjectSummary) {
    const confirmed = await this.options.ask({
      title: "删除项目？",
      description: `“${project.name}”中的画布和资产将被永久删除，此操作无法撤销。`,
      confirm: "确认删除",
      danger: true,
    });
    if (!confirmed) return false;
    const response = await removeProject(project.id);
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      this.options.toast(
        "项目删除失败",
        "error",
        result.error === "至少需要保留一个项目" ? result.error : "请稍后重试",
      );
      return false;
    }
    if (project.id === this.options.getCurrentProjectId()) {
      const next = this.projects.find((item) => item.id !== project.id);
      if (next) await this.options.deleteCurrentProject(next.id);
    }
    this.options.toast("项目已删除", "success");
    return true;
  }
}
