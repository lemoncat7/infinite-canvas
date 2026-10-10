import type { CanvasSnapshot } from './canvas-tools.js';
import { ApiFailure, type VioraGateway } from './gateway.js';

export function referenceAssetId(api: VioraGateway, value: string) {
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
export function sameReference(api: VioraGateway, a: string, b: string) {
  return a === b || Boolean(referenceAssetId(api, a) && referenceAssetId(api, a) === referenceAssetId(api, b));
}
export function connectedImageUrls(canvas: CanvasSnapshot, nodeId: unknown) {
  return canvas.links.filter(l => l.to === nodeId)
    .map(link => ({ link, node: canvas.nodes.find(n => n.id === link.from) }))
    .filter(item => item.node?.kind === 'image')
    .sort((a, b) => Number(a.link.inputOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.link.inputOrder ?? Number.MAX_SAFE_INTEGER)
      || Number(a.node!.y || 0) - Number(b.node!.y || 0) || Number(a.node!.x || 0) - Number(b.node!.x || 0) || Number(a.node!.id) - Number(b.node!.id))
    .map(item => typeof item.node!.mediaUrl === 'string' ? item.node!.mediaUrl : '');
}
export function assertReferenceInputs(api: VioraGateway, canvas: CanvasSnapshot, nodeId: unknown, urls: string[], allowMissing = false) {
  const connected = connectedImageUrls(canvas, nodeId);
  if (allowMissing) {
    let previous = -1;
    if (connected.every(url => { const index = urls.findIndex((candidate, i) => i > previous && Boolean(url) && sameReference(api, url, candidate)); previous = index; return index >= 0; })) return;
  }
  if (connected.length && (connected.length !== urls.length || connected.some((url, i) => !url || !sameReference(api, url, urls[i]))))
    throw new ApiFailure(400, `Reference mismatch: generator has ${connected.length} connected images but submission has ${urls.length}. Match inputUrls AND order to the generator links before submitting; no job was created.`);
}

/** Submission-only readiness gate. Historical canvas repair must not use this gate. */
export async function validateSubmissionReferences(api: VioraGateway, canvas: CanvasSnapshot, nodeId: unknown, urls: string[]) {
  const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
  const issues: Record<string, unknown>[] = [];
  for (const link of canvas.links.filter(link => link.to === nodeId)) {
    const node = nodes.get(link.from);
    const context = { nodeId: link.from, title: node?.title, jobId: node?.jobId };
    if (!node) { issues.push({ ...context, reason: 'reference_node_missing' }); continue; }
    if (node.kind !== 'image') continue;
    const url = typeof node.mediaUrl === 'string' ? node.mediaUrl.trim() : '';
    if (!url) issues.push({ ...context, reason: 'reference_image_empty' });
    if (node.status && node.status !== 'succeeded' && node.status !== 'idle')
      issues.push({ ...context, reason: 'reference_not_ready', status: node.status });
    if (node.jobId) {
      try {
        const job = await api.call<Record<string, unknown>>('GET', `/jobs/${encodeURIComponent(String(node.jobId))}`);
        if (job.status !== 'succeeded' || typeof job.result_url !== 'string' || !job.result_url.trim()
          || !url || !sameReference(api, url, job.result_url))
          issues.push({ ...context, reason: 'reference_job_not_ready_or_stale', status: job.status });
      } catch { issues.push({ ...context, reason: 'reference_job_unavailable' }); }
    }
  }
  if (issues.length) throw new ApiFailure(400, { code: 'REFERENCE_NOT_READY', nodeId, issues,
    message: '参考图尚未就绪；未创建任务、未扣费。请等待或修复列出的节点，并同步生成结果后再提交，不能省略参考图继续生成。' });
  try { assertReferenceInputs(api, canvas, nodeId, urls); }
  catch { throw new ApiFailure(400, { code: 'REFERENCE_MISMATCH', nodeId,
    referenceNodeIds: canvas.links.filter(link => link.to === nodeId && nodes.get(link.from)?.kind === 'image').map(link => link.from),
    expectedCount: connectedImageUrls(canvas, nodeId).length, actualCount: urls.length,
    message: '提交的参考图遗漏、地址或顺序与连线不一致；请读取画布并完整提交参考图。未创建任务、未扣费。' }); }
  for (const [index, url] of urls.entries()) {
    if (!url.trim()) throw new ApiFailure(400, { code: 'REFERENCE_EMPTY', index, message: '参考图地址为空，未创建任务。' });
    const id = referenceAssetId(api, url);
    if (!id) continue;
    try {
      const asset = await api.call<Record<string, unknown>>('GET', `/assets/${encodeURIComponent(decodeURIComponent(id))}`);
      if (!String(asset.mimeType).startsWith('image/') || !(Number(asset.size) > 0)) throw new Error('Invalid image asset');
    } catch { throw new ApiFailure(400, { code: 'REFERENCE_ASSET_UNAVAILABLE', index, assetId: id,
      message: '参考图片不存在、为空、不是图片或无权访问；未创建任务。' }); }
  }
}
