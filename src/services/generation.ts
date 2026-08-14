import { apiFetch } from "./api";
import type { FlowLink, FlowNode } from "../nodes/node-types";
import { prepareGenerationRequest } from "../nodes/generation-request";

export type GenerationJob = {
  id: string;
  status: string;
  progress: number;
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

export async function fetchGenerationJob(jobId: string) {
  const response = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`),
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
      generationPrompt: prepared.prompt,
      agentAuto: false,
    });
    return { ok: true as const, job, node: liveNode };
  } catch (error) {
    const liveNode = nodes.find((node) => node.id === output.id);
    if (liveNode) Object.assign(liveNode, { status: "failed", progress: 0 });
    return { ok: false as const, error, node: liveNode };
  }
}

export async function hydrateGenerationState(nodes: FlowNode[]) {
  await Promise.all(nodes
    .filter((node) => node.jobId)
    .map(async (node) => {
      try {
        const job = await fetchGenerationJob(node.jobId!);
        node.status = job.status;
        node.progress = Number(job.progress ?? 0);
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
      } catch { /* 保留现有内容，等待用户手动修正 */ }
    }));
}
