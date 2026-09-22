import { ApiFailure, type VioraGateway } from './gateway.js';
import { generationNodeFields, type McpJob } from './generation-canvas.js';

/** MCP callers need not know private UI flags. Validate task references through
 * the same user-scoped API before emitting complete records for canvas/sync. */
export async function prepareMcpNodes(api: VioraGateway, projectId: string, nodes: Record<string, unknown>[]) {
  const jobs = new Map<string, McpJob>();
  const prepared: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (node.jobId && (node.kind === 'video' || node.kind === 'image')) {
      if (typeof node.jobId !== 'string') throw new ApiFailure(400, 'jobId must be a string');
      let job = jobs.get(node.jobId);
      if (!job) {
        job = await api.call<McpJob>('GET', `/jobs/${encodeURIComponent(node.jobId)}`);
        jobs.set(node.jobId, job);
      }
      if (job.project_id !== projectId || job.kind !== node.kind)
        throw new ApiFailure(400, 'Job must belong to this project and match the node kind');
      prepared.push({ ...node, ...generationNodeFields(job) });
    } else prepared.push(node.kind === 'video' && node.mediaUrl ? { ...node, role: 'result' } : node);
  }
  return prepared;
}
