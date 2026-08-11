import { apiFetch } from "./api";

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
