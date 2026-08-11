import type { FlowLink, FlowNode } from "../nodes/node-types";
import { apiFetch } from "../services/api";
import {
  applyCanvasOperations,
  diffCanvasSnapshots,
  normalizeCanvasLinks,
  type CanvasSyncSnapshot,
} from "./sync";

type SyncResponse = {
  nodes?: FlowNode[]; links?: FlowLink[];
  camera?: CanvasSyncSnapshot["camera"];
  updatedAt?: string; version?: number;
  error?: string; message?: string;
};

export async function submitCanvasChanges(options: {
  projectId: string;
  clientId: string;
  baseline: CanvasSyncSnapshot;
  sentSnapshot: CanvasSyncSnapshot;
  captureLive: () => CanvasSyncSnapshot;
  signal: AbortSignal;
}) {
  const operations = diffCanvasSnapshots(options.baseline, options.sentSnapshot);
  if (!operations.length) return { kind: "unchanged" as const };
  const response = await apiFetch(`/api/projects/${options.projectId}/canvas/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: options.clientId,
      batchId: `batch_${crypto.randomUUID().replaceAll("-", "")}`,
      baseVersion: options.baseline.version,
      operations,
    }),
    signal: options.signal,
  });
  const result = (await response.json().catch(() => ({}))) as SyncResponse;
  if (response.status === 409 || response.status === 428)
    return { kind: "conflict" as const, error: result.error };
  if (!response.ok) throw new Error(result.message || "save failed");
  if (!result.updatedAt || !Number.isSafeInteger(result.version) || !Array.isArray(result.nodes) || !Array.isArray(result.links) || !result.camera)
    throw new Error("invalid canvas sync response");
  const liveSnapshot = options.captureLive();
  const postSubmitOperations = diffCanvasSnapshots(options.sentSnapshot, liveSnapshot);
  const serverSnapshot: CanvasSyncSnapshot = {
    nodes: structuredClone(result.nodes),
    links: normalizeCanvasLinks(result.links),
    camera: { ...result.camera },
    version: Number(result.version),
    updatedAt: result.updatedAt,
  };
  return {
    kind: "saved" as const,
    serverSnapshot,
    mergedSnapshot: applyCanvasOperations(serverSnapshot, postSubmitOperations),
    hasPostSubmitOperations: postSubmitOperations.length > 0,
  };
}
