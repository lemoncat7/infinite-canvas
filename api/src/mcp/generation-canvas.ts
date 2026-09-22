import { createHash } from 'node:crypto';
import type { CanvasSnapshot } from './canvas-tools.js';
import { ApiFailure, projectPath, type VioraGateway } from './gateway.js';
import { syncGenerationReferences } from './generation-references.js';

export type McpJob = Record<string, unknown> & {
  id: string; project_id: string; node_id: number; kind: string;
  status: string; progress: number;
};
type Node = Record<string, unknown>;
type SyncOptions = { createMissing?: boolean; repairReferences?: boolean };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const active = (status: unknown) => status === 'queued' || status === 'running';
function object(value: unknown): Record<string, unknown> {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

export function generationNodeFields(job: McpJob) {
  const parameters = object(job.parameters);
  return {
    jobId: job.id, status: job.status, progress: Number(job.progress) || 0,
    generationPrompt: String(job.prompt || ''), model: String(job.model || ''),
    ...(job.kind === 'video' ? { role: 'result', videoSettings: {
      seconds: String(parameters.seconds || '5'), resolution: String(parameters.resolution || '720p'),
      aspectRatio: String(parameters.aspect_ratio || '16:9'),
    } } : {}),
    ...(job.result_url ? { mediaUrl: String(job.result_url) } : {}),
    ...(job.result_metadata ? { videoResult: object(job.result_metadata) } : {}),
    error: job.error ? String(job.error) : undefined,
  };
}

/** Same result-card contract as the web UI; placement is MCP-only, no UI dependency. */
function createResult(id: number, source: Node, nodes: Node[], job: McpJob): Node {
  const width = 280, height = 220;
  let x = Number(source.x) + Number(source.width) + 110, y = Number(source.y);
  for (let slot = 0; slot < 100; slot++) {
    x = Number(source.x) + Number(source.width) + 110 + (slot % 8) * 390;
    y = Number(source.y) + Math.floor(slot / 8) * 270;
    if (!nodes.some(n => x < Number(n.x) + Number(n.width) + 24 && x + width + 24 > Number(n.x)
      && y < Number(n.y) + Number(n.height) + 24 && y + height + 24 > Number(n.y))) break;
  }
  return { id, publicId: `mcp-result-${job.id}`, kind: job.kind, sourceNodeId: source.id,
    x, y, width, height, title: job.kind === 'video' ? '视频生成结果' : '图片生成结果',
    body: '', accent: job.kind === 'video' ? '#ffb774' : '#8ee7ff', ...generationNodeFields(job) };
}

const pending = (job: McpJob, reason: string) => ({
  canvasLinked: false, canvasSync: 'pending', projectId: job.project_id, sourceNodeId: job.node_id,
  warning: `${reason} Job ${job.id} still exists. Do not generate again; retry viora_generation_sync with this jobId.`,
});

/** Only existing authenticated HTTP APIs. No storage, billing, worker or frontend changes. */
export async function syncGenerationCanvas(api: VioraGateway, initial: McpJob, options: SyncOptions = {}) {
  const result = await syncResultCanvas(api, initial, options);
  if (!('resultNodeId' in result)) return result;
  return { ...result, ...await syncGenerationReferences(api, initial, result.resultNodeId, options) };
}

async function syncResultCanvas(api: VioraGateway, initial: McpJob, options: SyncOptions = {}) {
  let job = initial;
  const path = `${projectPath(job.project_id)}/canvas`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Refresh the job on conflict; never downgrade a completed job with a stale poll.
      if (attempt) job = await api.call<McpJob>('GET', `/jobs/${encodeURIComponent(job.id)}`);
      const canvas = await api.call<CanvasSnapshot>('GET', path);
      const source = canvas.nodes.find(n => n.id === job.node_id && n.kind === job.kind);
      let target = canvas.nodes.find(n => n.kind === job.kind && n.jobId === job.id);
      // Recover legacy MCP cards only using an exact job/result match. Never guess the latest job.
      if (!target && source && !source.jobId && job.result_url && source.mediaUrl === job.result_url) target = source;
      if (!target && !options.createMissing) return pending(job, 'No linked result card. Use createMissing only if you intentionally want to add it.');
      if (!target && !source) return pending(job, 'Source card was removed or changed; it will not be recreated.');

      let creating = false;
      if (!target && job.kind === 'image' && source && !source.mediaUrl && !source.jobId) target = source;
      if (!target) {
        const lease = await api.call<{ start: number }>('POST', `${path}/id-block`, { count: 1 });
        target = createResult(lease.start, source!, canvas.nodes, job);
        creating = true;
      }
      const patch = generationNodeFields(job);
      const marker = fingerprint({ ...patch, ...(active(job.status) ? { status: 'active', progress: 0 } : {}) });
      const structuralMatch = target.jobId === job.id && (job.kind !== 'video' || target.role === 'result');
      const alreadySynced = target.mcpJobSync === marker && structuralMatch
        && (active(job.status) || (target.status === job.status && (!job.result_url || target.mediaUrl === job.result_url)));
      if (alreadySynced && !creating) return {
        canvasLinked: true, canvasSync: 'synced', projectId: job.project_id,
        sourceNodeId: job.node_id, resultNodeId: target.id, canvasVersion: canvas.version,
      };
      const value: Node = { ...target, ...patch, mcpJobSync: marker };
      const operations: Record<string, unknown>[] = [{ type: 'node', action: 'upsert', key: String(value.id), value }];
      if (creating) operations.push({ type: 'link', action: 'upsert', key: `${job.node_id}:${value.id}:right:left`,
        value: { from: job.node_id, to: value.id, fromSide: 'right', toSide: 'left' } });
      // A fixed creation batch makes concurrent submit retries converge on ONE result
      // even if they reserve different IDs. Unused reserved IDs are harmless.
      const batchId = creating ? `mcp-result-${job.id}` : `mcp-sync-${fingerprint([job.id, value.id, canvas.version, marker])}`;
      await api.call('POST', `${path}/sync`, { clientId: 'viora-mcp-client', batchId, baseVersion: canvas.version, operations });
      // Cached batches may describe an old snapshot: verify current membership, not the cached response.
      const verified = await api.call<CanvasSnapshot>('GET', path);
      const linked = verified.nodes.find(n => n.kind === job.kind && n.jobId === job.id && (job.kind !== 'video' || n.role === 'result'));
      if (!linked) return pending(job, 'Result card was removed or replaced during synchronization.');
      if (linked.mcpJobSync !== marker || (!active(job.status)
        && (linked.status !== job.status || (job.result_url && linked.mediaUrl !== job.result_url)))) {
        if (attempt < 2) continue;
        return pending(job, 'Result changed during synchronization; retry against the latest canvas.');
      }
      return { canvasLinked: true, canvasSync: 'synced', projectId: job.project_id,
        sourceNodeId: job.node_id, resultNodeId: linked.id, canvasVersion: verified.version };
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409 && attempt < 2) continue;
      return pending(job, error instanceof ApiFailure && error.status === 404
        ? 'Project or job is no longer available.' : 'Canvas synchronization failed or conflicted.');
    }
  }
  return pending(job, 'Canvas is still being edited.');
}
