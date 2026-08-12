export class HomeSceneController {
  private readonly scenes: HTMLElement[];
  private readonly sceneButtons: HTMLElement[];
  private target = 0;
  private touchY = 0;
  private wheelDelta = 0;
  private wheelResetTimer = 0;
  private wheelLockedUntil = 0;

  constructor(
    private readonly page: HTMLElement,
    private readonly loginModal: HTMLElement,
    private readonly preview: HTMLElement,
  ) {
    this.scenes = Array.from(this.page.querySelectorAll<HTMLElement>(".home-scene"));
    this.sceneButtons = Array.from(
      this.page.querySelectorAll<HTMLElement>("[data-home-scene]"),
    );
    this.bind();
    this.setTarget(0);
  }

  setTarget(value: number) {
    const next = Math.max(0, Math.min(3, Math.round(value)));
    if (next === this.target && this.page.dataset.scene === String(next)) return;
    this.target = next;
    this.scenes.forEach((element, index) => {
      element.classList.toggle("scene-before", index < next);
      element.classList.toggle("scene-active", index === next);
      element.classList.toggle("scene-after", index > next);
      element.classList.toggle("scene-dormant", Math.abs(index - next) > 1);
    });
    this.page.dataset.scene = String(next);
    this.sceneButtons.forEach((button) =>
        button.classList.toggle(
          "active",
          Number(button.dataset.homeScene) === next,
        ),
      );
  }

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
    this.sceneButtons.forEach((button) =>
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
