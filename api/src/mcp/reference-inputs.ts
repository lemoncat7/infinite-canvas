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
