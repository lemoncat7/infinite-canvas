import { apiFetch } from "./api";
import type { FlowLink, FlowNode } from "../nodes/node-types";
import type { GenerationStage } from "../nodes/node-types";
import { prepareGenerationRequest } from "../nodes/generation-request";

export type GenerationJob = {
  id: string;
  status: string;
  progress: number;
  progress_estimated?: boolean | number;
  generation_stage?: GenerationStage;
  creditsAvailable?: number;
  error?: string;
  result?: Record<string, unknown>;
  result_url?: string;
  result_metadata?: string;
  prompt?: string;
};

export type GenerationJobRequest = {
  projectId: string;
  nodeId: number;
  kind: "image" | "video";
  prompt: string;
  promptProfile: string;
  model?: string;
  inputUrls: string[];
  parameters: Record<string, unknown>;
};

export async function submitGenerationJob(request: GenerationJobRequest) {
  const response = await apiFetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
    job = (await response.json().catch(() => ({}))) as GenerationJob;
  if (!response.ok) throw new Error(job.error || "任务提交失败");
  return job;
}

export async function fetchGenerationJob(jobId: string, signal?: AbortSignal) {
  const response = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal }),
    job = (await response.json().catch(() => ({}))) as GenerationJob;
  if (!response.ok) throw new Error(job.error || "任务状态获取失败");
  return job;
}

export function missingGenerationInputs(source: FlowNode, nodes: FlowNode[], links: FlowLink[]) {
  return links
    .filter((link) => link.to === source.id)
    .map((link) => nodes.find((node) => node.id === link.from))
    .filter((node): node is FlowNode => node?.kind === "image" && !node.mediaUrl);
}

export async function runGenerationJob(options: {
  projectId: string;
  source: FlowNode;
  output: FlowNode;
  nodes: FlowNode[];
  links: FlowLink[];
  normalizePrompt: (value: string) => string;
}) {
  const { source, output, nodes, links } = options;
  try {
    const prepared = prepareGenerationRequest(source, output, nodes, links, options.normalizePrompt);
    if (prepared.corePrompt) {
      source.corePrompt = prepared.corePrompt;
      output.corePrompt = prepared.corePrompt;
      output.originalPrompt = prepared.originalPrompt;
    }
    const job = await submitGenerationJob({
      projectId: options.projectId,
      nodeId: output.id,
      kind: output.kind === "video" ? "video" : "image",
      prompt: prepared.prompt,
      promptProfile: source.promptProfile || "manual",
      model: output.model,
      inputUrls: prepared.inputUrls,
      parameters: prepared.parameters,
    });
    const liveNode = nodes.find((node) => node.id === output.id);
    if (!liveNode) throw new Error("任务已提交，但目标卡片已不存在");
    Object.assign(liveNode, {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      progressEstimated: Boolean(job.progress_estimated),
      generationStage: job.generation_stage ?? "local_queue",
      generationPrompt: prepared.prompt,
      agentAuto: false,
    });
    return { ok: true as const, job, node: liveNode };
  } catch (error) {
    const liveNode = nodes.find((node) => node.id === output.id);
    if (liveNode) Object.assign(liveNode, { status: "failed", progress: 0, progressEstimated: false });
    return { ok: false as const, error, node: liveNode };
  }
}

export function needsGenerationRecovery(node: FlowNode) {
  return Boolean(node.jobId) && !["failed", "canceled"].includes(node.status ?? "")
    && !(node.status === "succeeded" && node.mediaUrl);
}

export async function hydrateGenerationState(nodes: FlowNode[], options: {
  signal: AbortSignal;
  isCurrent: (node: FlowNode) => boolean;
  onRecovered: (node: FlowNode, changed: boolean) => void;
}) {
  const groups = new Map<string, FlowNode[]>();
  for (const node of nodes.filter(needsGenerationRecovery)) {
    const group = groups.get(node.jobId!) ?? [];
    group.push(node);
    groups.set(node.jobId!, group);
  }
  const queue = [...groups];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (!options.signal.aborted && cursor < queue.length) {
      const [jobId, group] = queue[cursor++];
      const snapshots = new Map(group.map((node) => [node, { status: node.status, mediaUrl: node.mediaUrl }]));
      let job: GenerationJob | undefined;
      try {
        job = await fetchGenerationJob(jobId, AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]));
      } catch { /* Keep saved content; active jobs resume through the poller. */ }
      for (const node of group) {
        if (options.signal.aborted || !options.isCurrent(node) || node.jobId !== jobId) continue;
        const snapshot = snapshots.get(node)!;
        if (node.status !== snapshot.status || node.mediaUrl !== snapshot.mediaUrl) continue;
        const before = JSON.stringify(node);
        if (job) {
          node.status = job.status;
          node.progress = Number(job.progress ?? 0);
          node.progressEstimated = Boolean(job.progress_estimated);
          node.generationStage = job.generation_stage;
          if (job.result_url) node.mediaUrl = job.result_url;
          if (job.result_metadata) {
            try {
              const metadata = JSON.parse(job.result_metadata);
              if (metadata && typeof metadata === "object") node.videoResult = metadata;
            } catch { /* 保留旧任务中可用的画布元数据。 */ }
          }
          if (job.prompt) {
            node.generationPrompt = job.prompt;
            if (node.body === "生成完成 · 结果已回写" || node.body === job.prompt)
              node.body = "";
          }
        }
        options.onRecovered(node, before !== JSON.stringify(node));
      }
    }
  }));
}
