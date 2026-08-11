export class HomeSceneController {
  private progress = 0;
  private target = 0;
  private frame = 0;
  private start = 0;
  private startedAt = 0;
  private touchY = 0;
  private wheelDelta = 0;
  private wheelResetTimer = 0;
  private wheelLockedUntil = 0;

  constructor(
    private readonly page: HTMLElement,
    private readonly loginModal: HTMLElement,
    private readonly preview: HTMLElement,
  ) {
    this.bind();
    this.setTarget(0);
  }

  setTarget(value: number) {
    const next = Math.max(0, Math.min(3, Math.round(value)));
    if (next === this.target && this.frame) return;
    this.start = this.progress;
    this.target = next;
    this.startedAt = performance.now();
    if (!this.frame) this.frame = requestAnimationFrame(this.animate);
  }

  private readonly animate = (now: number) => {
    const elapsed = Math.min(
      1,
      Math.max(0, (now - this.startedAt) / 700),
    );
    const eased = 1 - Math.pow(1 - elapsed, 3);
    this.progress = this.start + (this.target - this.start) * eased;
    if (elapsed >= 1) this.progress = this.target;
    this.page.style.setProperty("--home-progress", this.progress.toFixed(4));
    this.page
      .querySelectorAll<HTMLElement>(".home-scene")
      .forEach((element, index) => {
        const distance = index - this.progress;
        element.style.setProperty("--scene-distance", distance.toFixed(4));
        element.style.setProperty(
          "--scene-presence",
          Math.max(0, 1 - Math.abs(distance)).toFixed(4),
        );
      });
    const scene = Math.max(0, Math.min(3, Math.round(this.progress)));
    this.page.dataset.scene = String(scene);
    this.page
      .querySelectorAll<HTMLElement>("[data-home-scene]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          Number(button.dataset.homeScene) === scene,
        ),
      );
    if (elapsed < 1) this.frame = requestAnimationFrame(this.animate);
    else this.frame = 0;
  };

  private bind() {
    this.page.addEventListener(
      "wheel",
      (event) => {
        if (
          innerWidth <= 800 ||
          this.loginModal.classList.contains("open") ||
          this.preview.classList.contains("open") ||
          (event.target as HTMLElement).closest(".home-gallery-card")
        )
          return;
        event.preventDefault();
        if (performance.now() < this.wheelLockedUntil) return;
        this.wheelDelta += event.deltaY;
        window.clearTimeout(this.wheelResetTimer);
        this.wheelResetTimer = window.setTimeout(() => {
          this.wheelDelta = 0;
        }, 180);
        if (Math.abs(this.wheelDelta) < 54) return;
        this.setTarget(Math.round(this.target) + Math.sign(this.wheelDelta));
        this.wheelDelta = 0;
        this.wheelLockedUntil = performance.now() + 760;
      },
      { passive: false },
    );
    this.page
      .querySelectorAll<HTMLElement>("[data-home-scene]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.setTarget(Number(button.dataset.homeScene)),
        ),
      );
    this.page
      .querySelectorAll<HTMLAnchorElement>('a[href="#showcase"]')
      .forEach((link) =>
        link.addEventListener("click", (event) => {
          if (innerWidth <= 800) return;
          event.preventDefault();
          this.setTarget(3);
        }),
      );
    this.page.addEventListener(
      "touchstart",
      (event) => {
        this.touchY = event.touches[0]?.clientY ?? 0;
      },
      { passive: true },
    );
    this.page.addEventListener(
      "touchend",
      (event) => {
        if (innerWidth <= 800) return;
        const distance =
          this.touchY - (event.changedTouches[0]?.clientY ?? this.touchY);
        if (Math.abs(distance) > 45)
          this.setTarget(
            Math.round(this.target) + (distance > 0 ? 1 : -1),
          );
      },
      { passive: true },
    );
  }
}
