import type { ProjectSummary } from "../services/projects";
import { formatProjectTime } from "./dialogs/project-dialog";

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export function renderProjectList(options: {
  list: HTMLElement;
  count: HTMLElement;
  projects: readonly ProjectSummary[];
  currentProjectId: string;
  query: string;
  sort: string;
  onOpen(project: ProjectSummary): void;
  onAction(action: string, project: ProjectSummary): void;
}) {
  const query = options.query.trim().toLocaleLowerCase(),
    projects = [...options.projects]
      .filter((project) => project.name.toLocaleLowerCase().includes(query))
      .sort((a, b) =>
        options.sort === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : options.sort === "created"
            ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
  options.count.textContent = `${options.projects.length} 个项目`;
  options.list.innerHTML = "";
  if (!projects.length) {
    options.list.innerHTML = `<div class="project-list-empty"><b>⌕</b><span>${query ? "没有匹配的项目" : "还没有项目"}</span><small>${query ? "换个关键词试试" : "创建一个项目开始创作"}</small></div>`;
    return;
  }
  for (const project of projects) {
    const active = project.id === options.currentProjectId,
      card = document.createElement("article");
    card.className = `project-card${active ? " active" : ""}`;
    card.innerHTML = `<i class="project-preview">${project.previewUrl ? `<img src="${project.previewUrl}" alt="" loading="lazy">` : "<span>∞</span>"}</i><span class="project-copy"><span class="project-name"><strong>${escapeHtml(project.name)}</strong><button data-project-action="rename" type="button" aria-label="修改项目名称" title="修改名称"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"></path></svg></button></span><small>${active ? "<em>当前项目</em> · " : ""}${formatProjectTime(project.updatedAt)}</small><small>${project.nodeCount ?? 0} 个节点 · ${project.assetCount ?? 0} 项资产</small></span><button class="project-enter" type="button">进入</button><button data-project-action="delete" class="project-delete" type="button" aria-label="删除项目" title="删除项目"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg></button>`;
    card.querySelector<HTMLElement>(".project-preview")!.onclick = () =>
      options.onOpen(project);
    card.querySelector<HTMLButtonElement>(".project-enter")!.onclick = () =>
      options.onOpen(project);
    card
      .querySelectorAll<HTMLButtonElement>("[data-project-action]")
      .forEach((button) => {
        button.onclick = () =>
          options.onAction(button.dataset.projectAction!, project);
      });
    options.list.append(card);
  }
}
