export class ConnectionAutoPanController {
  private frame = 0;
  private pointer: { x: number; y: number } | null = null;

  constructor(private readonly options: {
    camera: { x: number; y: number };
    active: () => boolean;
    updatePointer: (x: number, y: number) => void;
    draw: () => void;
  }) {}

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pointer = null;
  }

  start(x: number, y: number) {
    this.pointer = { x, y };
    if (this.frame) return;
    let previous = performance.now();
    const tick = (now: number) => {
      if (!this.options.active() || !this.pointer) {
        this.frame = 0;
        return;
      }
      const elapsed = Math.min(2, (now - previous) / 16.67);
      const edge = 88;
      const maxSpeed = 14;
      const axisSpeed = (position: number, limit: number) =>
        position < edge
          ? -Math.min(1, Math.max(0, 1 - position / edge)) * maxSpeed
          : position > limit - edge
            ? Math.min(1, Math.max(0, 1 - (limit - position) / edge)) * maxSpeed
            : 0;
      const vx = axisSpeed(this.pointer.x, innerWidth);
      const vy = axisSpeed(this.pointer.y, innerHeight);
      if (vx || vy) {
        this.options.camera.x -= vx * elapsed;
        this.options.camera.y -= vy * elapsed;
        this.options.updatePointer(this.pointer.x, this.pointer.y);
        this.options.draw();
      }
      previous = now;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
