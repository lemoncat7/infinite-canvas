import { createHash } from 'node:crypto';
import type { CanvasSnapshot } from './canvas-tools.js';
import type { McpJob } from './generation-canvas.js';
import { ApiFailure, projectPath, type VioraGateway } from './gateway.js';

function inputUrls(job: McpJob): string[] {
  try {
    const value = typeof job.input_urls === 'string' ? JSON.parse(job.input_urls) : job.input_urls;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Boolean(v)) : [];
  } catch { return []; }
}

/** Normalize only this site's asset URLs; never equate external URLs by path. */
function assetId(api: VioraGateway, value: string) {
  try {
    let path = value;
    if (!value.startsWith('/api/')) {
      const url = new URL(value);
      if (url.origin !== new URL(api.downloadUrl('/')).origin) return undefined;
      path = url.pathname;
    }
    return /^\/api\/assets\/([^/?#]+)\/content(?:\/[^?#]*)?(?:[?#].*)?$/.exec(path)?.[1];
  } catch { return undefined; }
}

/** Reference provenance belongs to the job result, not a reusable generator's current inputs. */
export async function syncGenerationReferences(api: VioraGateway, job: McpJob, resultNodeId: unknown,
  options: { createMissing?: boolean; repairReferences?: boolean }) {
  const urls = inputUrls(job);
  if (!urls.length) return { referencesSync: 'not_required' };
  const marker = createHash('sha256').update(JSON.stringify([job.id, urls])).digest('hex').slice(0, 24);
  const path = `${projectPath(job.project_id)}/canvas`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const canvas = await api.call<CanvasSnapshot>('GET', path);
      const target = canvas.nodes.find(n => n.id === resultNodeId && n.jobId === job.id);
      if (!target) return { referencesSync: 'pending', referencesWarning: 'Result card missing; no references were recreated.' };
      // Polling must not undo the user's later deletion/rearrangement of references.
      if (target.mcpReferenceSync === marker && !options.repairReferences) return { referencesSync: 'synced' };
      const nodes = [...canvas.nodes], links = [...canvas.links];
      const operations: Record<string, unknown>[] = [];
      const unresolved: number[] = [];
      for (const [index, url] of urls.entries()) {
        const id = assetId(api, url);
        let reference = nodes.find(n => n.id !== target.id && n.kind === 'image' && typeof n.mediaUrl === 'string'
          && (n.mediaUrl === url || (id && assetId(api, n.mediaUrl) === id)));
        if (!reference && options.createMissing && id) {
          try {
            const asset = await api.call<{ id: string; projectId: string; name: string; mimeType: string; url: string }>('GET', `/assets/${encodeURIComponent(id)}`);
            if (asset.projectId === job.project_id && asset.mimeType.startsWith('image/')) {
              const lease = await api.call<{ start: number }>('POST', `${path}/id-block`, { count: 1 });
              const x = Number(target.x) - 370;
              let y = Number(target.y);
              while (nodes.some(n => x < Number(n.x) + Number(n.width) + 24 && x + 304 > Number(n.x)
                && y < Number(n.y) + Number(n.height) + 24 && y + 244 > Number(n.y))) y += 270;
              reference = { id: lease.start, kind: 'image', x, y, width: 280, height: 220,
                title: asset.name, body: '', accent: '#8ee7ff', mediaUrl: asset.url };
              nodes.push(reference);
              operations.push({ type: 'node', action: 'upsert', key: String(reference.id), value: reference });
            }
          } catch (error) {
            if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
          }
        }
        if (!reference) { unresolved.push(index); continue; }
        // Preserve existing user connections and their sides/order; never duplicate an edge.
        if (!links.some(l => l.from === reference!.id && l.to === target.id)) {
          const link = { from: reference.id, to: target.id, fromSide: 'right', toSide: 'left', inputOrder: index };
          links.push(link);
          operations.push({ type: 'link', action: 'upsert', key: `${reference.id}:${target.id}:right:left`, value: link });
        }
      }
      if (!unresolved.length && target.mcpReferenceSync !== marker) operations.push({ type: 'node', action: 'upsert', key: String(target.id), value: { ...target, mcpReferenceSync: marker } });
      if (operations.length) {
        await api.call('POST', `${path}/sync`, { clientId: 'viora-mcp-client',
          batchId: `mcp-refs-${marker}-${canvas.version}`, baseVersion: canvas.version, operations });
      }
      return unresolved.length ? { referencesSync: 'pending', unresolvedReferenceIndices: unresolved,
        referencesWarning: 'Some input images have no matching canvas card. Explicit generation_sync(createMissing=true) can add same-project image assets. External URLs are not fetched.' }
        : { referencesSync: 'synced' };
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409 && attempt < 2) continue;
      return { referencesSync: 'pending', referencesWarning: 'Reference linking failed or conflicted. Retry generation_sync with this jobId; do not generate again.' };
    }
  }
  return { referencesSync: 'pending' };
}
