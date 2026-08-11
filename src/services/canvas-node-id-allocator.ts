import { requestNodeIdLease } from "./node-id-lease";

export class CanvasNodeIdAllocator {
  nextId = 1;
  end = 0;
  private pending: Promise<boolean> | null = null;

  constructor(private readonly options: {
    projectId: () => string;
    notifyExhausted: () => void;
  }) {}

  ensureAtLeast(value: number) {
    this.nextId = Math.max(this.nextId, value);
  }

  restore(nextId: number, end: number) {
    this.nextId = nextId;
    this.end = end;
  }

  reset(nextId?: number) {
    if (nextId !== undefined) this.nextId = nextId;
    this.end = 0;
  }

  needsLease() {
    return this.nextId > this.end;
  }

  async reserve(projectId = this.options.projectId()) {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const result = await requestNodeIdLease(projectId);
        if (projectId !== this.options.projectId()) return false;
        this.restore(result.start, result.end);
        return true;
      } catch {
        return false;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  allocate() {
    if (this.nextId <= this.end) return this.nextId++;
    this.options.notifyExhausted();
    void this.reserve();
    return null;
  }
}
