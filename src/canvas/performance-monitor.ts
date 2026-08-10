export type CanvasPerformanceSnapshot = {
  frames: number;
  averagePaintMs: number;
  worstPaintMs: number;
  longPaints: number;
  worstFrameGapMs: number;
};

export class CanvasPerformanceMonitor {
  private frames = 0;
  private totalPaintMs = 0;
  private worstPaintMs = 0;
  private longPaints = 0;
  private worstFrameGapMs = 0;
  private lastFrameAt = 0;

  constructor(readonly enabled: boolean) {}

  beginFrame() {
    if (!this.enabled) return 0;
    const now = performance.now();
    if (this.lastFrameAt)
      this.worstFrameGapMs = Math.max(
        this.worstFrameGapMs,
        now - this.lastFrameAt,
      );
    this.lastFrameAt = now;
    return now;
  }

  endFrame(startedAt: number) {
    if (!this.enabled || !startedAt) return;
    const duration = performance.now() - startedAt;
    this.frames++;
    this.totalPaintMs += duration;
    this.worstPaintMs = Math.max(this.worstPaintMs, duration);
    if (duration >= 16.7) this.longPaints++;
  }

  snapshot(): CanvasPerformanceSnapshot {
    return {
      frames: this.frames,
      averagePaintMs: this.frames ? this.totalPaintMs / this.frames : 0,
      worstPaintMs: this.worstPaintMs,
      longPaints: this.longPaints,
      worstFrameGapMs: this.worstFrameGapMs,
    };
  }

  reset() {
    this.frames = 0;
    this.totalPaintMs = 0;
    this.worstPaintMs = 0;
    this.longPaints = 0;
    this.worstFrameGapMs = 0;
    this.lastFrameAt = 0;
  }
}
