export class HomeSceneController {
  private readonly scenes: HTMLElement[];
  private readonly preview: HTMLElement | null;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private activeIndex = 0;
  private touchStartY: number | null = null;
  private transitionLocked = false;

  constructor(private readonly page: HTMLElement) {
    const hero = this.page.querySelector<HTMLElement>(".home-hero")!;
    this.scenes = [
      hero,
      this.page.querySelector<HTMLElement>("#workflow")!,
      this.page.querySelector<HTMLElement>("#capabilities")!,
      this.page.querySelector<HTMLElement>("#assets-story")!,
      this.page.querySelector<HTMLElement>("#recovery")!,
      this.page.querySelector<HTMLElement>("#showcase")!,
    ];
    this.scenes.forEach((scene, index) => {
      scene.classList.add("home-scene");
      if (!scene.dataset.homeScene)
        scene.dataset.homeScene = scene.id || "hero";
      scene.classList.toggle("active", index === 0);
      scene.setAttribute("aria-hidden", String(index !== 0));
    });

    this.preview = hero.querySelector<HTMLElement>(".home-workspace-preview");
    this.preview?.addEventListener("pointermove", this.onPreviewPointerMove);
    this.preview?.addEventListener("pointerleave", this.resetPreviewTilt);
    this.page.addEventListener("wheel", this.onWheel, { passive: false });
    this.page.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.page.addEventListener("touchend", this.onTouchEnd, { passive: true });
    this.page.addEventListener("keydown", this.onKeyDown);
    this.page.querySelectorAll<HTMLElement>("[data-home-scene-target]").forEach((trigger) => {
      trigger.addEventListener("click", () => this.showByName(trigger.dataset.homeSceneTarget || "hero"));
    });
  }

  private readonly onWheel = (event: WheelEvent) => {
    if (this.hasModalOpen() || Math.abs(event.deltaY) < 8) return;
    const gallery = (event.target as Element | null)?.closest<HTMLElement>(".home-gallery");
    if (gallery && gallery.scrollWidth > gallery.clientWidth) {
      event.preventDefault();
      gallery.scrollLeft += event.deltaY;
      return;
    }
    event.preventDefault();
    this.step(Math.sign(event.deltaY));
  };

  private readonly onTouchStart = (event: TouchEvent) => {
    this.touchStartY = event.touches[0]?.clientY ?? null;
  };

  private readonly onTouchEnd = (event: TouchEvent) => {
    if (this.touchStartY === null || this.hasModalOpen()) return;
    const endY = event.changedTouches[0]?.clientY ?? this.touchStartY;
    const distance = this.touchStartY - endY;
    this.touchStartY = null;
    if (Math.abs(distance) > 48) this.step(Math.sign(distance));
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.hasModalOpen()) return;
    if (["ArrowDown", "PageDown"].includes(event.key)) this.step(1);
    if (["ArrowUp", "PageUp"].includes(event.key)) this.step(-1);
    if (event.key === "Home") this.show(0);
    if (event.key === "End") this.show(this.scenes.length - 1);
  };

  private step(direction: number) {
    if (this.transitionLocked) return;
    this.show(Math.max(0, Math.min(this.scenes.length - 1, this.activeIndex + direction)));
  }

  private showByName(name: string) {
    const index = this.scenes.findIndex((scene) => scene.id === name || scene.dataset.homeScene === name);
    this.show(index < 0 ? 0 : index);
  }

  private show(index: number) {
    if (index === this.activeIndex || index < 0 || index >= this.scenes.length) return;
    const direction = index > this.activeIndex ? 1 : -1;
    this.page.dataset.sceneDirection = direction > 0 ? "forward" : "backward";
    this.scenes.forEach((scene, sceneIndex) => {
      scene.classList.toggle("active", sceneIndex === index);
      scene.setAttribute("aria-hidden", String(sceneIndex !== index));
    });
    this.page.querySelectorAll<HTMLElement>("[data-home-scene-target]").forEach((trigger) => {
      trigger.classList.toggle("active", trigger.dataset.homeSceneTarget === this.scenes[index]?.dataset.homeScene);
    });
    this.page.style.setProperty("--home-scene-index", String(index));
    this.activeIndex = index;
    this.transitionLocked = true;
    window.setTimeout(() => { this.transitionLocked = false; }, this.reducedMotion.matches ? 20 : 650);
  }

  private hasModalOpen() {
    return Boolean(this.page.querySelector(".home-login-modal.open,.home-preview.open"));
  }

  private readonly onPreviewPointerMove = (event: PointerEvent) => {
    if (this.reducedMotion.matches || event.pointerType === "touch" || !this.preview) return;
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
