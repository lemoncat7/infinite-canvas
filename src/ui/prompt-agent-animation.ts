type PromptAgentAnimationOptions = {
  trigger: HTMLElement;
  panel: HTMLElement;
  isBusy: () => boolean;
  onBusy: () => void;
  onClose: () => void;
  onCancel: () => void;
  onOpen: () => void;
};

export class PromptAgentAnimationController {
  private readonly burst = document.createElement("div");
  private formTimer = 0;

  constructor(private readonly options: PromptAgentAnimationOptions) {
    this.burst.className = "agent-particle-burst";
    this.burst.innerHTML = Array.from({ length: 28 }, () => "<i></i>").join("");
    options.trigger.append(this.burst);
    this.burst.querySelectorAll<HTMLElement>("i").forEach((particle, index) => {
      const angle = index * 2.399 + (index % 4) * 0.19;
      const distance = 34 + ((index * 17) % 86);
      particle.style.setProperty("--hx", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--hy", `${Math.sin(angle) * distance * 0.72}px`);
      particle.style.setProperty("--delay", `${-(index % 14) * 61}ms`);
      particle.style.setProperty("--duration", `${720 + (index % 7) * 34}ms`);
    });
    options.trigger.addEventListener("pointerenter", () => this.showHover());
    options.trigger.addEventListener("pointerleave", () => this.hideHover());
    options.trigger.addEventListener("click", (event) => this.handleTrigger(event));
  }

  cancelFormation() {
    window.clearTimeout(this.formTimer);
    this.formTimer = 0;
  }

  position() {
    const trigger = this.options.trigger.getBoundingClientRect();
    const width = this.options.panel.offsetWidth || 330;
    const left = Math.max(10, Math.min(innerWidth - width - 10, trigger.left + trigger.width / 2 - width / 2));
    this.options.panel.style.right = "auto";
    this.options.panel.style.left = `${left}px`;
    this.options.panel.style.bottom = `${Math.max(82, innerHeight - trigger.top + 12)}px`;
  }

  disperse(withGathering = true) {
    if (this.options.isBusy()) {
      this.options.onBusy();
      return;
    }
    const { panel } = this.options;
    if (!panel.classList.contains("open") || (withGathering && panel.classList.contains("gathering"))) return;
    const panelRect = panel.getBoundingClientRect();
    let ghost: HTMLElement | null = null;
    let delay = 0;
    if (withGathering) {
      ghost = panel.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      ghost.classList.add("agent-disperse-ghost", "gathering");
      Object.assign(ghost.style, {
        left: `${panelRect.left}px`, top: `${panelRect.top}px`, right: "auto", bottom: "auto",
        width: `${panelRect.width}px`, height: `${panelRect.height}px`,
      });
      document.body.append(ghost);
      const target = { x: panelRect.width / 2, y: panelRect.height / 2 };
      const materials = [...ghost.querySelectorAll<HTMLElement>("[data-agent-context-node]")];
      materials.forEach((material, index) => {
        const rect = material.getBoundingClientRect();
        material.style.setProperty("--gather-x", `${target.x - (rect.left - panelRect.left + rect.width / 2)}px`);
        material.style.setProperty("--gather-y", `${target.y - (rect.top - panelRect.top + rect.height / 2)}px`);
        material.style.setProperty("--gather-delay", `${index * 18}ms`);
        material.classList.add("is-gathering");
      });
      delay = Math.max(190, materials.length * 18 + 150);
    }
    this.options.onClose();
    window.setTimeout(() => this.createDisperseField(panelRect, ghost, withGathering), delay);
  }

  playMeteor(start: { x: number; y: number }, end: { x: number; y: number }, target?: HTMLElement | null) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const meteor = document.createElement("div");
    meteor.className = "agent-meteor";
    Object.assign(meteor.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${distance}px`, rotate: `${Math.atan2(dy, dx)}rad` });
    meteor.style.setProperty("--distance", `${distance}px`);
    meteor.innerHTML = Array.from({ length: 18 }, (_, index) => `<i style="--delay:${index * 13}ms;--lane:${((index % 5) - 2) * 3}px"></i>`).join("");
    document.body.append(meteor);
    target?.classList.add("agent-materializing");
    window.setTimeout(() => {
      meteor.remove();
      target?.classList.remove("agent-materializing");
    }, 900);
  }

  private createDisperseField(rect: DOMRect, ghost: HTMLElement | null, gathering: boolean) {
    const field = document.createElement("div");
    field.className = "agent-disperse-field";
    Object.assign(field.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    field.innerHTML = Array.from({ length: 82 }, (_, index) => {
      const angle = index * 2.399963;
      const distance = (gathering ? 28 : 32) + (index % 11) * (gathering ? 5 : 6);
      return `<i style="left:${(index * 37) % 100}%;top:${(index * 61) % 100}%;width:${2 + (index % 4)}px;height:${2 + (index % 4)}px;--scatter-x:${Math.cos(angle) * distance}px;--scatter-y:${Math.sin(angle) * distance * 0.72}px;--particle-delay:${(index % 9) * 8}ms"></i>`;
    }).join("");
    document.body.append(field);
    ghost?.classList.add("dispersing");
    requestAnimationFrame(() => field.classList.add("active"));
    window.setTimeout(() => { field.remove(); ghost?.remove(); }, 680);
  }

  private showHover() {
    this.burst.style.left = "50%";
    this.burst.style.top = "50%";
    this.burst.classList.add("hover-active");
  }

  private hideHover() { this.burst.classList.remove("hover-active"); }

  private form() {
    this.cancelFormation();
    this.position();
    const trigger = this.options.trigger.getBoundingClientRect();
    const panel = this.options.panel.getBoundingClientRect();
    this.options.panel.style.setProperty("--agent-origin-x", `${Math.max(0, Math.min(panel.width, trigger.left + trigger.width / 2 - panel.left))}px`);
    this.options.panel.style.setProperty("--agent-origin-y", `${Math.max(0, Math.min(panel.height, trigger.top + trigger.height / 2 - panel.top))}px`);
    this.showHover();
    this.options.panel.classList.add("forming");
    this.options.trigger.classList.add("active");
    this.formTimer = window.setTimeout(() => {
      this.formTimer = 0;
      this.openFormedPanel();
    }, 40);
  }

  private openFormedPanel() {
    this.options.panel.classList.remove("forming");
    this.options.panel.classList.add("open");
    this.options.panel.querySelector("textarea")?.focus();
    this.options.onOpen();
  }

  private handleTrigger(event: Event) {
    event.stopPropagation();
    if (this.options.panel.classList.contains("open")) {
      this.disperse(false);
      return;
    }
    if (this.options.panel.classList.contains("forming")) {
      this.cancelFormation();
      this.openFormedPanel();
      return;
    }
    if (!this.options.panel.classList.contains("open")) this.form();
  }
}
