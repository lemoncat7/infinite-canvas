import type { FlowNode } from "../nodes/node-types";
import { fetchGenerationJob, type GenerationJob } from "./generation";

type Options = {
  nodes: FlowNode[];
  onProgress: (node: FlowNode, job: GenerationJob, changed: boolean) => void;
  onRetry: (node: FlowNode) => void;
  onTerminal: (node: FlowNode, job: GenerationJob) => Promise<void> | void;
  onSyncFailure: (failures: number, notify: boolean) => void;
};

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
        const changed = current.status !== job.status || Number(current.progress ?? 0) !== Number(job.progress ?? 0);
        const terminal = job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
        current.status = job.status; current.progress = Number(job.progress ?? 0);
        if (current.kind === "image" && job.status === "running" && job.progress === 20 && !this.retryNotified.has(jobId)) {
          this.retryNotified.add(jobId); this.o.onRetry(current);
        }
        if (!terminal) this.o.onProgress(current, job, changed);
        if (!terminal) return;
        this.cancel(jobId); this.retryNotified.delete(jobId);
        if (this.finalized.has(jobId)) return;
        this.finalized.add(jobId);
        if (this.finalized.size > 200) this.finalized.delete(this.finalized.values().next().value!);
        await this.o.onTerminal(current, job);
      } catch {
        failures++;
        if (failures >= 5 && !failureNotified) failureNotified = true;
        this.o.onSyncFailure(failures, failureNotified && failures === 5);
      }
    }, 1500);
    this.timers.set(jobId, timer);
  };
}
