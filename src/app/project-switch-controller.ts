export class ProjectSwitchController {
  constructor(private readonly options: {
    currentProjectId: () => string;
    setCurrentProjectId: (id: string) => void;
    loadedProjectId: () => string;
    save: () => Promise<unknown>;
    stopSave: () => Promise<unknown>;
    resetNodeLease: () => void;
    closeComic: () => void;
    resetComic: () => void;
    unlinkComicLabel: () => void;
    loadCanvas: () => Promise<unknown>;
    loadAssets: () => Promise<unknown>;
    closePanels: () => void;
  }) {}

  private selectProject(projectId: string) {
    this.options.setCurrentProjectId(projectId);
    localStorage.setItem("flow-project-id", projectId);
  }

  async switch(projectId: string) {
    const current = this.options.currentProjectId();
    if (projectId === current) {
      this.options.closePanels();
      return;
    }
    if (this.options.loadedProjectId() === current) await this.options.save();
    this.options.closeComic();
    await this.options.stopSave();
    this.options.resetNodeLease();
    this.selectProject(projectId);
    this.options.resetComic();
    this.options.unlinkComicLabel();
    await Promise.all([this.options.loadCanvas(), this.options.loadAssets()]);
    this.options.closePanels();
  }

  async selectAfterDelete(projectId: string) {
    this.selectProject(projectId);
    await Promise.all([this.options.loadCanvas(), this.options.loadAssets()]);
  }
}
