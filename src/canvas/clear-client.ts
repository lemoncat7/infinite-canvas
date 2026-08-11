import type { FlowLink, FlowNode } from "../nodes/node-types";
import { apiFetch } from "../services/api";
import type { CanvasCamera } from "./store";

export async function cancelActiveProjectJobs(projectId: string) {
  const response = await apiFetch(
    `/api/projects/${projectId}/jobs/cancel-active`,
    { method: "POST" },
  );
  const result = (await response.json().catch(() => ({}))) as {
    canceled?: number;
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || "取消任务失败");
  return Math.max(0, Number(result.canceled) || 0);
}

export async function clearCanvasDocument(
  projectId: string,
  requestedVersion: number,
) {
  const response = await apiFetch(`/api/projects/${projectId}/canvas/clear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: requestedVersion, preserveLabels: true }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    version?: number;
    updatedAt?: string;
    message?: string;
    nodes?: FlowNode[];
    links?: FlowLink[];
    camera?: CanvasCamera;
  };
  if (
    !response.ok ||
    result.version !== requestedVersion ||
    !Array.isArray(result.nodes) ||
    !Array.isArray(result.links)
  )
    throw new Error(result.message || "清除画布失败，请重新载入后再试");
  return {
    version: result.version,
    updatedAt: result.updatedAt,
    nodes: result.nodes,
    links: result.links,
    camera: result.camera,
  };
}
