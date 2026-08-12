export class HomeSceneController {
  private readonly observer: IntersectionObserver | null;
  private readonly scenes: HTMLElement[];
  private readonly preview: HTMLElement | null;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private frame = 0;

  constructor(
    private readonly page: HTMLElement,
    _loginModal: HTMLElement,
    _preview: HTMLElement,
  ) {
    this.scenes = Array.from(
      this.page.querySelectorAll<HTMLElement>(".home-scene"),
    );
    this.preview = this.page.querySelector<HTMLElement>(".home-workspace-preview");
    this.scenes.forEach((scene, index) => {
      scene.classList.add("home-reveal");
      if (index === 0) scene.classList.add("is-visible");
    });

    this.observer = "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting)
                (entry.target as HTMLElement).classList.add("is-visible");
            });
          },
          { root: this.page, rootMargin: "0px 0px -12%", threshold: 0.14 },
        )
      : null;

    this.scenes.slice(1).forEach((scene) => this.observer?.observe(scene));
    if (!this.observer)
      this.scenes.forEach((scene) => scene.classList.add("is-visible"));

    this.page.addEventListener("scroll", this.onScroll, { passive: true });
    this.preview?.addEventListener("pointermove", this.onPreviewPointerMove);
    this.preview?.addEventListener("pointerleave", this.resetPreviewTilt);
    this.updateScrollEffects();
  }

  private readonly onScroll = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.updateScrollEffects();
    });
  };

  private updateScrollEffects() {
    const viewport = Math.max(1, this.page.clientHeight);
    const heroProgress = this.clamp(this.page.scrollTop / (viewport * 0.72));
    this.page.style.setProperty("--hero-progress", heroProgress.toFixed(4));
    this.page.classList.toggle("is-scrolled", this.page.scrollTop > 12);

    this.scenes.forEach((scene) => {
      const rect = scene.getBoundingClientRect();
      const start = viewport * 0.86;
      const end = Math.min(viewport * 0.18, start - rect.height);
      const progress = this.clamp((start - rect.top) / Math.max(1, start - end));
      scene.style.setProperty("--scene-progress", progress.toFixed(4));
    });
  }

  private readonly onPreviewPointerMove = (event: PointerEvent) => {
    if (this.reducedMotion.matches || event.pointerType === "touch" || !this.preview)
      return;
    const rect = this.preview.getBoundingClientRect();
    const x = this.clamp((event.clientX - rect.left) / rect.width) - 0.5;
    const y = this.clamp((event.clientY - rect.top) / rect.height) - 0.5;
    this.preview.style.setProperty("--preview-tilt-x", `${(-y * 1.8).toFixed(2)}deg`);
    this.preview.style.setProperty("--preview-tilt-y", `${(x * 2.2).toFixed(2)}deg`);
  };

  private readonly resetPreviewTilt = () => {
    this.preview?.style.setProperty("--preview-tilt-x", "0deg");
    this.preview?.style.setProperty("--preview-tilt-y", "0deg");
  };

  private clamp(value: number) {
    return Math.max(0, Math.min(1, value));
  }
}
