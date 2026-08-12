import type { FlowNode } from "../nodes/node-types";
import { fetchGenerationJob, type GenerationJob } from "./generation";

type Options = {
  nodes: FlowNode[];
  onProgress: (node: FlowNode, job: GenerationJob, changed: boolean) => void;
  onRetry: (node: FlowNode) => void;
  onTerminal: (node: FlowNode, job: GenerationJob) => Promise<void> | void;
  onSyncFailure: (failures: number, notify: boolean) => void;
};

export function mergeGenerationState(
  current: Pick<FlowNode, "status" | "progress">,
  incoming: Pick<GenerationJob, "status" | "progress">,
) {
  const terminal = ["succeeded", "failed", "canceled"].includes(incoming.status);
  const preventQueueRegression = current.status === "running" && incoming.status === "queued";
  const status = preventQueueRegression ? "running" : incoming.status;
  const progress =
    !terminal && status === "running"
      ? Math.max(Number(current.progress ?? 0), Number(incoming.progress ?? 0))
      : Number(incoming.progress ?? 0);
  return { status, progress, terminal };
}

export class GenerationPoller {
  private readonly timers = new Map<string, number>();
  private readonly retryNotified = new Set<string>();
  private readonly finalized = new Set<string>();

  constructor(private readonly o: Options) {
    window.addEventListener("online", this.resume);
    window.addEventListener("focus", this.resume);
  }

  cancel(jobId: string) {
    const timer = this.timers.get(jobId);
    if (timer) window.clearInterval(timer);
    this.timers.delete(jobId);
  }
  cancelAll() { this.timers.forEach((timer) => window.clearInterval(timer)); this.timers.clear(); }
  resume = () => this.o.nodes
    .filter((node) => node.jobId && (node.status === "queued" || node.status === "running"))
    .forEach((node) => this.poll(node));

  poll = (node: FlowNode) => {
    if (!node.jobId) return;
    const jobId = node.jobId, nodeId = node.id;
    this.cancel(jobId);
    let failures = 0, failureNotified = false;
    const timer = window.setInterval(async () => {
      let current = this.o.nodes.find((item) => item.id === nodeId);
      if (!current?.jobId || current.jobId !== jobId) return this.cancel(jobId);
      try {
        const job = await fetchGenerationJob(jobId);
        current = this.o.nodes.find((item) => item.id === nodeId);
        if (!current?.jobId || current.jobId !== jobId) return this.cancel(jobId);
        failures = 0; failureNotified = false;
        const merged = mergeGenerationState(current, job);
        const changed = current.status !== merged.status || Number(current.progress ?? 0) !== merged.progress;
        current.status = merged.status; current.progress = merged.progress;
        const stableJob = { ...job, status: merged.status, progress: merged.progress };
        if (current.kind === "image" && merged.status === "running" && merged.progress === 20 && !this.retryNotified.has(jobId)) {
          this.retryNotified.add(jobId); this.o.onRetry(current);
        }
        if (!merged.terminal) this.o.onProgress(current, stableJob, changed);
        if (!merged.terminal) return;
        this.cancel(jobId); this.retryNotified.delete(jobId);
        if (this.finalized.has(jobId)) return;
        this.finalized.add(jobId);
        if (this.finalized.size > 200) this.finalized.delete(this.finalized.values().next().value!);
        await this.o.onTerminal(current, stableJob);
      } catch {
        failures++;
        if (failures >= 5 && !failureNotified) failureNotified = true;
        this.o.onSyncFailure(failures, failureNotified && failures === 5);
      }
    }, 1500);
    this.timers.set(jobId, timer);
  };
}
