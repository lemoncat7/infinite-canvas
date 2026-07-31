import './style.css'

type Point = { x: number; y: number }
type NodeKind = 'prompt' | 'image' | 'video' | 'note'
type PortSide = 'top' | 'right' | 'bottom' | 'left'
type FlowNode = Point & { id: number; publicId?: string; kind: NodeKind; width: number; height: number; title: string; body: string; accent: string; model?: string; jobId?: string; progress?: number; status?: string; mediaUrl?: string; fontScale?: number; imageSettings?: { size?: string; quality?: string; background?: string } }
type FlowLink = { from: number; to: number; fromSide: PortSide; toSide: PortSide }

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const ctx = canvas.getContext('2d')!
const nodeViewport = document.querySelector<HTMLElement>('#node-viewport')!
const nodeLayer = document.querySelector<HTMLElement>('#node-layer')!
const zoomSlider = document.querySelector<HTMLInputElement>('#zoom-slider')!
const zoomPercent = document.querySelector<HTMLOutputElement>('#zoom-percent')!
const nodeCount = document.querySelector<HTMLSpanElement>('#node-count')!
const titleInput = document.querySelector<HTMLInputElement>('#node-title')!
const promptInput = document.querySelector<HTMLTextAreaElement>('#node-prompt')!
const modelInput = document.querySelector<HTMLSelectElement>('#node-model')!
const saveState = document.querySelector<HTMLSpanElement>('#save-state')!
const jobLabel = document.querySelector<HTMLSpanElement>('#job-label')!
const jobProgress = document.querySelector<HTMLElement>('#job-progress')!
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!
const contextMenu = document.querySelector<HTMLDivElement>('#context-menu')!
const camera = { x: 80, y: 10, zoom: 0.9 }
const pointer = { down: false, x: 0, y: 0, draggingNode: null as number | null }
let selectedId = 0
let editingTextNodeId = 0
let nextId = 1
let contextPosition: Point = { x: 0, y: 0 }
let contextNodeId: number | null = null
let connecting: { nodeId: number; side: PortSide; pointer: Point } | null = null
let currentProjectId = localStorage.getItem('flow-project-id') ?? 'default'
let backgroundMode: 'dots' | 'lines' | 'blank' = 'lines'
let colorTheme: 'light' | 'dark' = localStorage.getItem('flow-theme') === 'light' ? 'light' : 'dark'
document.body.dataset.theme = colorTheme
function clientLog(event: string, details: unknown = {}) {
  const payload = { event, details, userAgent: navigator.userAgent, path: location.pathname, timestamp: new Date().toISOString() }
  console.info('[client-diagnostic]', payload)
  void fetch('/api/client-logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {})
}
window.addEventListener('error', event => clientLog('window-error', { message: event.message, file: event.filename, line: event.lineno, column: event.colno, stack: event.error?.stack }))
window.addEventListener('unhandledrejection', event => clientLog('unhandled-rejection', { reason: event.reason instanceof Error ? { message: event.reason.message, stack: event.reason.stack } : String(event.reason) }))
const interruptedThemeTransition = sessionStorage.getItem('flow-theme-transition-inflight')
if (interruptedThemeTransition) { sessionStorage.removeItem('flow-theme-transition-inflight'); try { clientLog('theme-transition-interrupted', JSON.parse(interruptedThemeTransition)) } catch { clientLog('theme-transition-interrupted', { raw: interruptedThemeTransition }) } }
let domDrag: { id: number; startX: number; startY: number; initialX: number; initialY: number; element: HTMLElement; moved: boolean } | null = null
let domDragFrame: number | null = null
let suppressNodeReleaseUntil = 0
let domResize: { id: number; startX: number; startY: number; width: number; height: number } | null = null

const nodes: FlowNode[] = []
const links: FlowLink[] = []
let saveTimer: number | undefined
let drawFrame: number | null = null
let cameraFrame: number | null = null
let zoomTarget = camera.zoom
let zoomAnchor: Point = { x: innerWidth / 2, y: innerHeight / 2 }
const imageCache = new Map<string, HTMLImageElement>()
const pendingMediaLoads = new Set<string>()
const activeJobPolls = new Map<string, number>()

const screen = (p: Point): Point => ({ x: innerWidth / 2 + camera.x + p.x * camera.zoom, y: innerHeight / 2 + camera.y + p.y * camera.zoom })
const world = (p: Point): Point => ({ x: (p.x - innerWidth / 2 - camera.x) / camera.zoom, y: (p.y - innerHeight / 2 - camera.y) / camera.zoom })

function roundedRect(x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }

function drawGrid() {
  if (backgroundMode === 'blank') return
  const gap = 42 * camera.zoom
  if (gap < 10) return
  const origin = screen({ x: 0, y: 0 })
  if (backgroundMode === 'lines') { ctx.beginPath(); for (let x = origin.x % gap; x < innerWidth; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight) } for (let y = origin.y % gap; y < innerHeight; y += gap) { ctx.moveTo(0, y); ctx.lineTo(innerWidth, y) } ctx.strokeStyle = colorTheme === 'dark' ? 'rgba(245,245,244,.10)' : 'rgba(68,64,60,.12)'; ctx.lineWidth = 1; ctx.stroke(); return }
  ctx.fillStyle = colorTheme === 'dark' ? 'rgba(245,245,244,.24)' : 'rgba(68,64,60,.28)'
  for (let x = origin.x % gap; x < innerWidth; x += gap) for (let y = origin.y % gap; y < innerHeight; y += gap) { ctx.beginPath(); ctx.arc(x, y, Math.max(.65, camera.zoom), 0, Math.PI * 2); ctx.fill() }
}

function portWorld(node: FlowNode, side: PortSide): Point {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y }
  if (side === 'right') return { x: node.x + node.width, y: node.y + node.height / 2 }
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
  return { x: node.x, y: node.y + node.height / 2 }
}

function controlPoint(point: Point, side: PortSide, distance: number): Point {
  if (side === 'top') return { x: point.x, y: point.y - distance }
  if (side === 'right') return { x: point.x + distance, y: point.y }
  if (side === 'bottom') return { x: point.x, y: point.y + distance }
  return { x: point.x - distance, y: point.y }
}

function drawLink(link: FlowLink) {
  const from = nodes.find(n => n.id === link.from), to = nodes.find(n => n.id === link.to)
  if (!from || !to) return
  const a = screen(portWorld(from, link.fromSide)), b = screen(portWorld(to, link.toSide))
  ctx.beginPath(); ctx.moveTo(a.x, a.y)
  const curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .35)
  const ca = controlPoint(a, link.fromSide, curve), cb = controlPoint(b, link.toSide, curve)
  ctx.bezierCurveTo(ca.x, ca.y, cb.x, cb.y, b.x, b.y)
  ctx.strokeStyle = 'rgba(183,190,201,.5)'; ctx.lineWidth = 2 * camera.zoom; ctx.stroke()
  for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5 * camera.zoom, 0, Math.PI * 2); ctx.fillStyle = '#aab1ba'; ctx.fill() }
}

function drawNode(node: FlowNode) {
  const p = screen(node), w = node.width * camera.zoom, h = node.height * camera.zoom, selected = node.id === selectedId
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 28 * camera.zoom
  roundedRect(p.x, p.y, w, h, 16 * camera.zoom); ctx.fillStyle = '#1c1f1d'; ctx.fill(); ctx.shadowColor = 'transparent'
  if (selected) { ctx.strokeStyle = node.accent; ctx.lineWidth = 2; ctx.stroke() }
  if (node.kind === 'image' && node.mediaUrl) { let image = imageCache.get(node.mediaUrl); if (!image) { image = new Image(); image.onload = () => { const ratio = image!.naturalHeight / image!.naturalWidth; node.height = Math.max(190, 92 + (node.width - 24) * ratio); scheduleSave(); draw() }; image.src = node.mediaUrl; imageCache.set(node.mediaUrl, image) } if (image.complete && image.naturalWidth) { const ix = p.x + 12 * camera.zoom, iy = p.y + 78 * camera.zoom, iw = w - 24 * camera.zoom, ih = h - 92 * camera.zoom; ctx.save(); roundedRect(ix, iy, iw, ih, 10 * camera.zoom); ctx.clip(); const scale = Math.min(iw / image.naturalWidth, ih / image.naturalHeight), dw = image.naturalWidth * scale, dh = image.naturalHeight * scale; ctx.fillStyle = '#111'; ctx.fillRect(ix, iy, iw, ih); ctx.drawImage(image, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh); ctx.restore() } }
  ctx.fillStyle = node.accent; roundedRect(p.x + 14 * camera.zoom, p.y + 14 * camera.zoom, 34 * camera.zoom, 24 * camera.zoom, 7 * camera.zoom); ctx.fill()
  ctx.fillStyle = '#171917'; ctx.font = `700 ${10 * camera.zoom}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(node.kind.toUpperCase(), p.x + 31 * camera.zoom, p.y + 30 * camera.zoom)
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4f5f1'; ctx.font = `600 ${17 * camera.zoom}px system-ui`; ctx.fillText(node.title, p.x + 16 * camera.zoom, p.y + 66 * camera.zoom)
  if (!node.mediaUrl) { ctx.fillStyle = '#929991'; ctx.font = `${12 * camera.zoom}px system-ui`; const words = node.body.split(''); let line = '', y = p.y + 92 * camera.zoom; for (const char of words) { if (ctx.measureText(line + char).width > w - 32 * camera.zoom) { ctx.fillText(line, p.x + 16 * camera.zoom, y); line = char; y += 20 * camera.zoom } else line += char } ctx.fillText(line, p.x + 16 * camera.zoom, y) }
  if (!node.mediaUrl && (node.kind === 'image' || node.kind === 'video')) { const iy = p.y + h - 49 * camera.zoom; roundedRect(p.x + 15 * camera.zoom, iy, w - 30 * camera.zoom, 34 * camera.zoom, 9 * camera.zoom); ctx.fillStyle = '#282c29'; ctx.fill(); ctx.fillStyle = node.accent; ctx.font = `${11 * camera.zoom}px system-ui`; ctx.fillText(node.kind === 'video' ? '▶  生成预览' : '✦  查看生成结果', p.x + 28 * camera.zoom, iy + 21 * camera.zoom) }
  const sides: PortSide[] = ['top', 'right', 'bottom', 'left']
  for (const side of sides) { const port = screen(portWorld(node, side)); ctx.beginPath(); ctx.arc(port.x, port.y, 6 * camera.zoom, 0, Math.PI * 2); ctx.fillStyle = selected ? node.accent : '#656b65'; ctx.fill(); ctx.strokeStyle = '#171917'; ctx.lineWidth = 2 * camera.zoom; ctx.stroke() }
  ctx.restore()
}

function hitNode(sx: number, sy: number) { const p = world({ x: sx, y: sy }); return [...nodes].reverse().find(n => p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) }
function hitPort(sx: number, sy: number) { const sides: PortSide[] = ['top', 'right', 'bottom', 'left']; for (const node of [...nodes].reverse()) for (const side of sides) { const p = screen(portWorld(node, side)); if (Math.hypot(sx - p.x, sy - p.y) <= 12) return { node, side } } }
function drawPendingLink() { if (!connecting) return; const node = nodes.find(item => item.id === connecting!.nodeId); if (!node) return; const a = screen(portWorld(node, connecting.side)), b = connecting.pointer; ctx.beginPath(); ctx.moveTo(a.x, a.y); const distance = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .3), control = controlPoint(a, connecting.side, distance); ctx.quadraticCurveTo(control.x, control.y, b.x, b.y); ctx.strokeStyle = node.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]) }
function paint() { drawFrame = null; ctx.fillStyle = colorTheme === 'dark' ? '#181715' : '#f4f2ed'; ctx.fillRect(0, 0, innerWidth, innerHeight); drawGrid(); links.forEach(drawLink); drawPendingLink(); syncDomNodes(); zoomSlider.value = String(Math.round(camera.zoom * 100)); zoomSlider.title = `${Math.round(camera.zoom * 100)}%`; zoomPercent.value = `${Math.round(camera.zoom * 100)}%`; nodeCount.textContent = String(nodes.length) }
function draw() { if (drawFrame === null) drawFrame = requestAnimationFrame(paint) }
function resize() { const ratio = devicePixelRatio || 1; canvas.width = innerWidth * ratio; canvas.height = innerHeight * ratio; canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw() }
function setZoom(next: number, anchor = { x: innerWidth / 2, y: innerHeight / 2 }) { const old = camera.zoom; next = Math.min(2.5, Math.max(.3, next)); const cx = innerWidth / 2 + camera.x, cy = innerHeight / 2 + camera.y; camera.x += (anchor.x - cx) * (1 - next / old); camera.y += (anchor.y - cy) * (1 - next / old); camera.zoom = next; draw() }
function smoothZoom(next: number, anchor: Point) {
  zoomTarget = Math.min(2.5, Math.max(.3, next)); zoomAnchor = anchor
  if (cameraFrame !== null) return
  const tick = () => {
    const difference = zoomTarget - camera.zoom
    if (Math.abs(difference) < .001) { setZoom(zoomTarget, zoomAnchor); cameraFrame = null; scheduleSave(); return }
    setZoom(camera.zoom + difference * .24, zoomAnchor)
    cameraFrame = requestAnimationFrame(tick)
  }
  cameraFrame = requestAnimationFrame(tick)
}
function fitCanvas() {
  const start = { ...camera }
  let target = { x: 0, y: 0, zoom: 1 }
  if (nodes.length) {
  const compact = innerWidth <= 780
  const viewport = { left: compact ? 68 : 82, top: 86, right: innerWidth - 16, bottom: innerHeight - 118 }
  const padding = 44
  const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y))
  const maxX = Math.max(...nodes.map(node => node.x + node.width)), maxY = Math.max(...nodes.map(node => node.y + node.height))
  const contentWidth = Math.max(1, maxX - minX), contentHeight = Math.max(1, maxY - minY)
  const availableWidth = Math.max(1, viewport.right - viewport.left - padding * 2), availableHeight = Math.max(1, viewport.bottom - viewport.top - padding * 2)
  const targetZoom = Math.min(1.15, Math.max(.3, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)))
  const worldCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const viewportCenter = { x: (viewport.left + viewport.right) / 2, y: (viewport.top + viewport.bottom) / 2 }
  target = { x: viewportCenter.x - innerWidth / 2 - worldCenter.x * targetZoom, y: viewportCenter.y - innerHeight / 2 - worldCenter.y * targetZoom, zoom: targetZoom }
  }
  if (cameraFrame !== null) cancelAnimationFrame(cameraFrame)
  zoomTarget = target.zoom
  const startedAt = performance.now(), duration = 420
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration), eased = 1 - Math.pow(1 - progress, 3)
    camera.x = start.x + (target.x - start.x) * eased; camera.y = start.y + (target.y - start.y) * eased; camera.zoom = start.zoom + (target.zoom - start.zoom) * eased; draw()
    if (progress < 1) cameraFrame = requestAnimationFrame(tick)
    else { cameraFrame = null; scheduleSave() }
  }
  cameraFrame = requestAnimationFrame(tick)
}
function makePublicId(kind: NodeKind) { const type = kind === 'prompt' ? 'text' : kind; return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function addNode(kind: NodeKind = 'image', position?: Point) { const center = position ?? world({ x: innerWidth / 2, y: innerHeight / 2 }); const titles = { prompt: '文本', image: '文生图 · 新任务', video: '图生视频 · 新任务', note: '创作便签' }; nodes.push({ id: nextId, publicId: makePublicId(kind), kind, x: center.x - 130, y: center.y - 80, width: 265, height: kind === 'note' ? 135 : 175, title: titles[kind], body: kind === 'image' ? '' : kind === 'prompt' ? '输入你的创意描述' : '等待配置模型与生成参数', accent: kind === 'video' ? '#ffb774' : kind === 'prompt' ? '#e7ff70' : kind === 'note' ? '#b6efa2' : '#8ee7ff', model: kind === 'video' ? 'Kling 2.1' : 'gpt-image-2' }); selectedId = nextId++; updateEditor(); scheduleSave(); draw() }
function addMediaNode(url: string, title: string, position = contextPosition) { nodes.push({ id: nextId, kind: 'image', x: position.x - 145, y: position.y - 120, width: 290, height: 240, title, body: '项目素材', accent: '#8ee7ff', mediaUrl: url, model: 'Flux 1.1 Pro' }); selectedId = nextId++; updateEditor(); scheduleSave(); draw() }

function syncDomNodes() {
  nodeViewport.style.transform = `translate(${innerWidth / 2 + camera.x}px, ${innerHeight / 2 + camera.y}px) scale(${camera.zoom})`
  const live = new Set(nodes.map(node => String(node.id)))
  nodeLayer.querySelectorAll<HTMLElement>('.flow-node').forEach(element => { if (!live.has(element.dataset.id!)) element.remove() })
  for (const node of nodes) {
    let element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`)
    if (!element) { element = createDomNode(node); nodeLayer.append(element) }
    const locked = node.status === 'queued' || node.status === 'running'
    node.width = 280; node.height = 220
    element.className = `flow-node kind-${node.kind}${node.id === selectedId ? ' selected' : ''}${locked ? ' generating' : ''}`
    element.style.transform = `translate(${node.x}px, ${node.y}px)`; element.style.width = `${node.width}px`; element.style.height = `${node.height}px`; element.style.setProperty('--accent', node.accent); element.style.setProperty('--font-scale', String(node.fontScale ?? 1))
    const copy = element.querySelector<HTMLElement>('.node-copy')!; if (editingTextNodeId !== node.id) copy.textContent = node.body || defaultNodeCopy(node.kind)
    element.querySelector<HTMLElement>('.node-kind')!.textContent = node.kind === 'prompt' ? 'TEXT' : node.kind === 'note' ? 'NOTE' : node.kind === 'video' ? 'VIDEO' : 'IMAGE'
    element.querySelectorAll<HTMLElement>('[data-action]').forEach(button => button.hidden = false)
    for (const action of ['zoom-in', 'zoom-out']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = node.kind !== 'prompt'
    element.querySelector<HTMLElement>('[data-action="preview"]')!.hidden = !node.mediaUrl
    element.querySelector<HTMLElement>('[data-action="generate"]')!.hidden = node.kind === 'note' || node.kind === 'prompt'
    if (node.kind === 'image') for (const action of ['edit', 'zoom-in', 'zoom-out', 'generate', 'preview']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = true
    if (node.kind === 'image') {
      element.querySelector<HTMLElement>('[data-action="info"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg><span>信息</span></span>'
      element.querySelector<HTMLElement>('[data-action="delete"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>删除</span></span>'
    }
    if (node.kind === 'prompt') {
      element.querySelector<HTMLElement>('[data-action="info"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg><span>信息</span></span>'
      element.querySelector<HTMLElement>('[data-action="edit"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg><span>编辑</span></span>'
      element.querySelector<HTMLElement>('[data-action="zoom-in"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M11 8v6"></path><path d="M8 11h6"></path></svg><span>放大</span></span>'
      element.querySelector<HTMLElement>('[data-action="zoom-out"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M8 11h6"></path></svg><span>缩小</span></span>'
      element.querySelector<HTMLElement>('[data-action="delete"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>删除</span></span>'
    }
    element.querySelector<HTMLElement>('.node-info-popover')!.textContent = `文字节点 · ${node.body.length} 字 · ${Math.round((node.fontScale ?? 1) * 100)}%`
    const imagePanel = element.querySelector<HTMLElement>('.image-config-panel')!; const imagePanelOpen = node.kind === 'image' && node.id === selectedId; imagePanel.classList.toggle('open', imagePanelOpen); if (!imagePanelOpen) imagePanel.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(details => details.open = false)
    if (node.kind === 'image') {
      const model = imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!, description = imagePanel.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!
      if (document.activeElement !== model) model.value = node.model ?? 'gpt-image-2'; imagePanel.querySelector<HTMLElement>('[data-image-model-label]')!.textContent = node.model ?? 'gpt-image-2'; if (document.activeElement !== description) description.value = node.body
      for (const key of ['size', 'quality', 'background'] as const) { const input = imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!; if (document.activeElement !== input) input.value = node.imageSettings?.[key] ?? 'auto' }
      const sizeLabel = ({ auto: '自动尺寸', '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3' } as Record<string, string>)[node.imageSettings?.size ?? 'auto'] ?? node.imageSettings?.size
      const qualityLabel = ({ auto: '自动质量', high: '高质量', medium: '标准质量', low: '低质量' } as Record<string, string>)[node.imageSettings?.quality ?? 'auto'] ?? node.imageSettings?.quality
      imagePanel.querySelector<HTMLElement>('[data-image-settings-label]')!.textContent = `${qualityLabel} · ${sizeLabel}`
      const generateButton = imagePanel.querySelector<HTMLButtonElement>('[data-image-generate]')!; generateButton.disabled = locked || !node.body.trim(); generateButton.classList.toggle('is-running', locked); generateButton.innerHTML = locked ? '<i></i><b>生成中</b>' : '<span>↑</span><b>生成</b>'
    }
    const media = element.querySelector<HTMLElement>('.node-media')!
    if (node.mediaUrl) { media.dataset.hasMedia = 'true'; if (media.dataset.sourceKey !== node.mediaUrl) { media.dataset.sourceKey = node.mediaUrl; paintNodeMedia(element.querySelector<HTMLCanvasElement>('.node-media-canvas')!, node.mediaUrl) } }
    else { delete media.dataset.hasMedia; delete media.dataset.sourceKey; const mediaCanvas = element.querySelector<HTMLCanvasElement>('.node-media-canvas')!; mediaCanvas.getContext('2d')!.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height) }
    const progress = element.querySelector<HTMLElement>('.node-progress i')!; progress.style.width = `${node.progress ?? 0}%`
    element.querySelector<HTMLElement>('.node-progress')!.classList.toggle('visible', locked)
  }
}

function createDomNode(node: FlowNode) {
  const element = document.createElement('article'); element.dataset.id = String(node.id); element.className = 'flow-node'
  element.innerHTML = `<div class="node-floating-tools"><button data-action="info" title="信息">ⓘ</button><button data-action="edit" title="编辑">✎</button><button data-action="zoom-in" title="放大文字">＋</button><button data-action="zoom-out" title="缩小文字">−</button><button data-action="generate" title="生成">✦</button><button data-action="preview" title="预览">⌕</button><button data-action="delete" title="删除">⌫</button></div><div class="node-info-popover"></div><div class="node-port input" data-side="left"></div><div class="node-port output" data-side="right"></div><span class="node-kind"></span><div class="node-media"><canvas class="node-media-canvas" width="560" height="440"></canvas></div><div class="image-empty-state"><span>▧</span><b>空图节点</b><small>连接参考图，或在下方描述要生成的图片</small></div><div class="node-copy"></div><div class="node-progress"><i></i></div><section class="image-config-panel"><div class="image-composer-title"><span>IMAGE</span><small>描述你想创造的画面</small></div><textarea data-image-field="description" rows="4" aria-label="图片描述" placeholder="例如：清晨薄雾中的未来城市，电影感光影…"></textarea><footer><details class="image-model-picker"><summary><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"></path></svg><b data-image-model-label>gpt-image-2</b><i>⌄</i></summary><div class="image-model-menu"><small>选择图像模型</small><button type="button" data-image-model="gpt-image-2"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg><span><b>gpt-image-2</b><small>OpenAI 图像生成</small></span><i>✓</i></button></div><select data-image-field="model" aria-label="模型" hidden><option value="gpt-image-2">gpt-image-2</option></select></details><details><summary><span>⚙</span><b data-image-settings-label>自动质量 · 自动尺寸</b><i>⌃</i></summary><div class="image-settings-popover"><header><span>图像设置</span><small>调整输出规格</small></header><label><span><b>质量</b><small>细节与生成速度</small></span><select data-image-field="quality"><option value="auto">自动质量</option><option value="high">高质量</option><option value="medium">标准质量</option><option value="low">低质量</option></select></label><label><span><b>画面尺寸</b><small>输出宽高比例</small></span><select data-image-field="size"><option value="auto">自动尺寸</option><option value="1024x1024">1:1 · 1024 × 1024</option><option value="1536x1024">3:2 · 1536 × 1024</option><option value="1024x1536">2:3 · 1024 × 1536</option></select></label><label><span><b>背景</b><small>画面底色模式</small></span><select data-image-field="background"><option value="auto">自动背景</option><option value="transparent">透明背景</option><option value="opaque">不透明背景</option></select></label></div></details><button data-image-generate type="button" title="开始生成" aria-label="生成"><span>↑</span></button></footer></section>`
  element.addEventListener('mousedown', event => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button,.node-port,.image-config-panel') || target.closest('.node-copy[contenteditable="true"]')) return
    event.preventDefault(); event.stopPropagation(); selectedId = node.id; updateEditor()
    if (node.status === 'queued' || node.status === 'running') { draw(); return }
    domDrag = { id: node.id, startX: event.clientX, startY: event.clientY, initialX: node.x, initialY: node.y, element, moved: false }; element.classList.add('dragging'); draw()
  })
  element.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); selectedId = node.id; updateEditor(); if (node.kind === 'prompt') enterTextEdit(node, element) })
  element.addEventListener('dragstart', event => event.preventDefault())
  element.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); showContextMenu(event.clientX, event.clientY, node) })
  element.querySelectorAll<HTMLElement>('.node-port').forEach(port => port.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); selectedId = node.id; connecting = { nodeId: node.id, side: port.dataset.side as PortSide, pointer: { x: event.clientX, y: event.clientY } }; draw() }))
  element.querySelector('[data-action="info"]')!.addEventListener('click', event => { event.stopPropagation(); openNodeInfo(node) })
  element.querySelector('[data-action="edit"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); if (node.kind === 'prompt') enterTextEdit(node, element); else promptInput.focus() })
  element.querySelector('[data-action="zoom-in"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.min(2, (node.fontScale ?? 1) + .1); scheduleSave(); draw() })
  element.querySelector('[data-action="zoom-out"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.max(.7, (node.fontScale ?? 1) - .1); scheduleSave(); draw() })
  element.querySelector('[data-action="generate"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); void generate() })
  element.querySelector('[data-action="preview"]')!.addEventListener('click', event => { event.stopPropagation(); if (node.mediaUrl) openAssetPreview(node.mediaUrl, node.title) })
  element.querySelector('[data-action="delete"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; deleteSelectedNode() })
  const imagePanel = element.querySelector<HTMLElement>('.image-config-panel')!
  imagePanel.addEventListener('mousedown', event => event.stopPropagation())
  imagePanel.addEventListener('click', event => event.stopPropagation())
  imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!.addEventListener('change', event => { node.model = (event.target as HTMLSelectElement).value; scheduleSave() })
  imagePanel.querySelectorAll<HTMLButtonElement>('[data-image-model]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); const select = imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!; select.value = button.dataset.imageModel!; select.dispatchEvent(new Event('change')); imagePanel.querySelector<HTMLDetailsElement>('.image-model-picker')!.open = false; draw() }))
  imagePanel.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!.addEventListener('input', event => { node.body = (event.target as HTMLTextAreaElement).value; setSaveState('editing', '编辑中…'); scheduleSave(); draw() })
  for (const key of ['size', 'quality', 'background'] as const) imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!.addEventListener('change', event => { node.imageSettings = { ...(node.imageSettings ?? {}), [key]: (event.target as HTMLSelectElement).value }; scheduleSave() })
  imagePanel.querySelector('[data-image-generate]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); void generate() })
  return element
}

function enterTextEdit(node: FlowNode, element: HTMLElement) {
  if (node.kind !== 'prompt' || node.status === 'queued' || node.status === 'running') return
  const copy = element.querySelector<HTMLElement>('.node-copy')!
  editingTextNodeId = node.id; copy.contentEditable = 'true'; copy.classList.add('editing'); copy.focus()
  const range = document.createRange(); range.selectNodeContents(copy); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  const finish = () => { if (editingTextNodeId !== node.id) return; node.body = copy.innerText.trim(); editingTextNodeId = 0; copy.contentEditable = 'false'; copy.classList.remove('editing'); copy.oninput = null; copy.onkeydown = null; copy.onblur = null; scheduleSave(); updateEditor(); draw() }
  copy.oninput = () => { node.body = copy.innerText; setSaveState('editing', '编辑中…') }
  copy.onkeydown = event => { if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) { event.preventDefault(); copy.blur() } }
  copy.onblur = finish
}

const nodeInfoModal = document.querySelector<HTMLElement>('#node-info-modal')!
const nodeInfoDetails = document.querySelector<HTMLElement>('#node-info-details')!
const nodeInfoJson = document.querySelector<HTMLElement>('#node-info-json')!
function nodeInfoData(node: FlowNode) {
  node.publicId ||= makePublicId(node.kind)
  return { id: node.publicId, type: node.kind === 'prompt' ? 'text' : node.kind, title: node.kind === 'prompt' ? '文本' : node.title, position: { x: node.x, y: node.y }, width: node.width, height: node.height, metadata: { content: node.body, status: node.status ?? 'idle', fontSize: Math.round(12 * (node.fontScale ?? 1)) } }
}
function openNodeInfo(node: FlowNode) {
  const info = nodeInfoData(node)
  nodeInfoDetails.innerHTML = `<dl><div><dt>ID</dt><dd>${escapeHtml(info.id)}</dd></div><div><dt>名称</dt><dd>${escapeHtml(info.title)}</dd></div><div><dt>类型</dt><dd>文本</dd></div><div><dt>尺寸</dt><dd>${Math.round(info.width)} × ${Math.round(info.height)}</dd></div><div><dt>位置</dt><dd>${Math.round(info.position.x)}, ${Math.round(info.position.y)}</dd></div><div><dt>状态</dt><dd><i></i>${escapeHtml(info.metadata.status)}</dd></div></dl>`
  nodeInfoJson.textContent = JSON.stringify(info, null, 2); nodeInfoDetails.hidden = false; nodeInfoJson.hidden = true
  nodeInfoModal.querySelectorAll('[data-info-tab]').forEach(button => button.classList.toggle('active', (button as HTMLElement).dataset.infoTab === 'details'))
  nodeInfoModal.classList.add('open'); scheduleSave()
}
function closeNodeInfo() { nodeInfoModal.classList.remove('open') }
document.querySelector('#close-node-info')!.addEventListener('click', closeNodeInfo)
nodeInfoModal.addEventListener('click', event => { if (event.target === nodeInfoModal) closeNodeInfo() })
nodeInfoModal.querySelectorAll<HTMLElement>('[data-info-tab]').forEach(button => button.addEventListener('click', () => { const json = button.dataset.infoTab === 'json'; nodeInfoDetails.hidden = json; nodeInfoJson.hidden = !json; nodeInfoModal.querySelectorAll('[data-info-tab]').forEach(item => item.classList.toggle('active', item === button)) }))

function defaultNodeCopy(kind: NodeKind) { return kind === 'prompt' ? '双击输入提示词' : kind === 'image' ? '空图节点' : kind === 'video' ? '连接提示词或图片，生成视频' : '双击添加说明文字' }

function paintNodeMedia(target: HTMLCanvasElement, url: string) {
  let image = imageCache.get(url)
  if (!image) {
    image = new Image(); imageCache.set(url, image); pendingMediaLoads.add(url); refreshAppearanceButton()
    image.onload = () => { pendingMediaLoads.delete(url); repaintMediaUrl(url); refreshAppearanceButton() }
    image.onerror = () => { pendingMediaLoads.delete(url); repaintMediaUrl(url); refreshAppearanceButton() }
    image.src = url
  }
  drawMediaImage(target, image)
}
function drawMediaImage(target: HTMLCanvasElement, image: HTMLImageElement) {
  const context = target.getContext('2d')!
  const fill = colorTheme === 'dark' ? '#292524' : '#e7e5df'
  context.fillStyle = fill; context.fillRect(0, 0, target.width, target.height)
  if (image.complete && image.naturalWidth) { const scale = Math.min(target.width / image.naturalWidth, target.height / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale; context.drawImage(image, (target.width - width) / 2, (target.height - height) / 2, width, height) }
  else if (image.complete) { context.fillStyle = '#777'; context.font = '24px system-ui'; context.textAlign = 'center'; context.fillText('图片加载失败', target.width / 2, target.height / 2) }
}
function repaintMediaUrl(url: string) { const image = imageCache.get(url); if (!image) return; nodes.filter(node => node.mediaUrl === url).forEach(node => { const target = nodeLayer.querySelector<HTMLCanvasElement>(`.flow-node[data-id="${node.id}"] .node-media-canvas`); if (target) drawMediaImage(target, image!) }) }
function repaintAllMedia() { nodes.filter(node => node.mediaUrl).forEach(node => repaintMediaUrl(node.mediaUrl!)) }

window.addEventListener('pointermove', event => {
  if (domResize) { const node = nodes.find(item => item.id === domResize!.id); if (!node) return; const width = Math.max(220, domResize.width + (event.clientX - domResize.startX) / camera.zoom); let height = Math.max(160, domResize.height + (event.clientY - domResize.startY) / camera.zoom); if (node.mediaUrl && !event.shiftKey) height = Math.max(180, domResize.height * width / domResize.width); node.width = width; node.height = height; setSaveState('editing', '编辑中…'); draw() }
  if (connecting) { connecting.pointer = { x: event.clientX, y: event.clientY }; draw() }
})
window.addEventListener('pointerup', event => {
  if (domResize) { domResize = null; scheduleSave() }
  if (!connecting) return
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.node-port'); const targetNode = target?.closest<HTMLElement>('.flow-node'); const toId = Number(targetNode?.dataset.id)
  if (target && toId && toId !== connecting.nodeId) { const side = target.dataset.side as PortSide; const next = connecting.side === 'left' ? { from: toId, to: connecting.nodeId, fromSide: side, toSide: connecting.side } : { from: connecting.nodeId, to: toId, fromSide: connecting.side, toSide: side }; if (!links.some(link => link.from === next.from && link.to === next.to)) links.push(next); scheduleSave() }
  connecting = null; draw()
})
window.addEventListener('mousemove', event => {
  if (!domDrag) return
  if (event.buttons === 0) { domDrag.element.classList.remove('dragging'); domDrag = null; return }
  const drag = domDrag, dx = (event.clientX - drag.startX) / camera.zoom, dy = (event.clientY - drag.startY) / camera.zoom
  if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.moved = true
  if (domDragFrame !== null) cancelAnimationFrame(domDragFrame)
  domDragFrame = requestAnimationFrame(() => { const node = nodes.find(item => item.id === drag.id); if (node) { node.x = drag.initialX + dx; node.y = drag.initialY + dy; setSaveState('editing', '编辑中…'); draw() } domDragFrame = null })
})
window.addEventListener('mouseup', event => {
  if (!domDrag || event.button !== 0) return
  if (domDragFrame !== null) { cancelAnimationFrame(domDragFrame); domDragFrame = null }
  const drag = domDrag, node = nodes.find(item => item.id === drag.id)
  if (node && drag.moved) { node.x = drag.initialX + (event.clientX - drag.startX) / camera.zoom; node.y = drag.initialY + (event.clientY - drag.startY) / camera.zoom }
  if (drag.moved) suppressNodeReleaseUntil = performance.now() + 700
  drag.element.classList.remove('dragging'); domDrag = null; scheduleSave(); draw()
})
window.addEventListener('blur', () => { if (domDrag) domDrag.element.classList.remove('dragging'); domDrag = null; if (domDragFrame !== null) cancelAnimationFrame(domDragFrame); domDragFrame = null })
window.addEventListener('dragstart', event => { if ((event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) { event.preventDefault(); event.stopImmediatePropagation(); if (event.dataTransfer) event.dataTransfer.clearData() } }, true)
window.addEventListener('dragend', event => { if ((event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
window.addEventListener('drop', event => { event.preventDefault(); if (performance.now() < suppressNodeReleaseUntil || (event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) event.stopImmediatePropagation() }, true)
for (const type of ['click', 'auxclick'] as const) window.addEventListener(type, event => { if (performance.now() < suppressNodeReleaseUntil) { event.preventDefault(); event.stopImmediatePropagation() } }, true)

function deleteSelectedNode() {
  const index = nodes.findIndex(node => node.id === selectedId)
  if (index < 0) return
  if (nodes[index].status === 'queued' || nodes[index].status === 'running') return
  const deletedId = nodes[index].id
  nodes.splice(index, 1)
  for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--) {
    if (links[linkIndex].from === deletedId || links[linkIndex].to === deletedId) links.splice(linkIndex, 1)
  }
  selectedId = nodes[Math.min(index, nodes.length - 1)]?.id ?? 0
  updateEditor(); scheduleSave(); draw()
}

function hideContextMenu() { contextMenu.classList.remove('open') }
function showContextMenu(clientX: number, clientY: number, node?: FlowNode) {
  contextPosition = world({ x: clientX, y: clientY }); contextNodeId = node?.id ?? null
  if (node) { selectedId = node.id; updateEditor(); draw() }
  document.querySelector<HTMLButtonElement>('#context-delete')!.style.display = node ? 'flex' : 'none'
  const width = 180, height = node ? 390 : 350
  contextMenu.style.left = `${Math.min(clientX, innerWidth - width - 10)}px`
  contextMenu.style.top = `${Math.min(clientY, innerHeight - height - 10)}px`
  contextMenu.classList.add('open')
}

function selectedNode() { return nodes.find(node => node.id === selectedId) }
function updateEditor() {
  const node = selectedNode()
  if (!node) {
    titleInput.value = ''; promptInput.value = ''; jobLabel.textContent = '画布中没有节点'; jobProgress.style.width = '0%'
    titleInput.disabled = true; promptInput.disabled = true; modelInput.disabled = true
    return
  }
  const locked = node.status === 'queued' || node.status === 'running'
  titleInput.disabled = locked; promptInput.disabled = locked; modelInput.disabled = locked; generateButton.disabled = locked
  titleInput.value = node.title
  promptInput.value = node.body
  modelInput.value = node.model ?? (node.kind === 'video' ? 'Kling 2.1' : 'gpt-image-2')
  jobLabel.textContent = node.status === 'succeeded' ? '生成完成（模拟结果）' : node.status === 'running' ? `生成中 ${node.progress ?? 0}%` : node.status === 'queued' ? '任务排队中' : '准备生成'
  jobProgress.style.width = `${node.progress ?? 0}%`
}

function scheduleSave() {
  setSaveState('editing', '编辑中…')
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveCanvas, 500)
}

async function saveCanvas() {
  try {
    setSaveState('saving', '正在自动保存…')
    const response = await fetch(`/api/projects/${currentProjectId}/canvas`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodes, links, camera }) })
    if (!response.ok) throw new Error('save failed')
    setSaveState('saved', '已自动保存')
  } catch { setSaveState('error', '自动保存失败') }
}

function setSaveState(state: 'editing' | 'saving' | 'saved' | 'error', label: string) { saveState.dataset.state = state; saveState.textContent = label }

async function loadCanvas() {
  try {
    activeJobPolls.forEach(timer => window.clearInterval(timer)); activeJobPolls.clear()
    const response = await fetch(`/api/projects/${currentProjectId}/canvas`)
    if (response.status === 404) { await saveCanvas(); return }
    if (!response.ok) throw new Error('load failed')
    const document = await response.json() as { nodes: FlowNode[]; links: Array<FlowLink | [number, number]>; camera?: typeof camera }
    nodes.splice(0, nodes.length, ...(document.nodes ?? [])); nodes.forEach(node => { if (node.kind === 'image' && !node.mediaUrl && node.body === '等待配置模型与生成参数') node.body = '' }); const migrated = (document.links ?? []).map(link => Array.isArray(link) ? { from: link[0], to: link[1], fromSide: 'right' as PortSide, toSide: 'left' as PortSide } : link); links.splice(0, links.length, ...migrated); nextId = nodes.length ? Math.max(...nodes.map(node => node.id)) + 1 : 1
    if (document.camera) { Object.assign(camera, document.camera); zoomTarget = camera.zoom }
    selectedId = nodes[0]?.id ?? 0; setSaveState('saved', '已自动保存'); updateEditor(); draw()
    nodes.filter(node => node.jobId && (node.status === 'queued' || node.status === 'running')).forEach(pollJob)
  } catch { setSaveState('error', '离线模式') }
}

async function generate() {
  const node = selectedNode()
  if (!node || !node.body.trim()) { promptInput.focus(); return }
  jobLabel.textContent = '正在提交…'
  try {
    const upstream = links.filter(link => link.to === node.id).map(link => nodes.find(item => item.id === link.from)).filter((item): item is FlowNode => Boolean(item))
    const inputUrls = upstream.map(item => item.mediaUrl).filter((url): url is string => Boolean(url))
    const promptParts = [...upstream.filter(item => item.kind === 'prompt' || item.kind === 'note').map(item => item.body.trim()).filter(Boolean), node.body.trim()]
    const parameters = node.kind === 'image' ? Object.fromEntries(Object.entries(node.imageSettings ?? {}).filter(([, value]) => value && value !== 'auto')) : undefined
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId, nodeId: node.id, kind: node.kind === 'video' ? 'video' : 'image', prompt: promptParts.join('\n\n'), model: node.model, inputUrls, parameters }) })
    if (!response.ok) throw new Error('job failed')
    const job = await response.json() as { id: string; status: string; progress: number }
    node.jobId = job.id; node.status = job.status; node.progress = job.progress; updateEditor(); scheduleSave(); pollJob(node)
  } catch { jobLabel.textContent = '提交失败，请检查 API' }
}

function pollJob(node: FlowNode) {
  if (!node.jobId) return
  const jobId = node.jobId
  const previousTimer = activeJobPolls.get(jobId); if (previousTimer) window.clearInterval(previousTimer)
  let failures = 0
  const timer = window.setInterval(async () => {
    if (!node.jobId || node.jobId !== jobId) { window.clearInterval(timer); activeJobPolls.delete(jobId); return }
    try {
      const response = await fetch(`/api/jobs/${jobId}`)
      if (!response.ok) throw new Error(`job status ${response.status}`)
      const job = await response.json() as { status: string; progress: number; result_url?: string; error?: string }
      failures = 0; node.status = job.status
      if (job.status === 'running') {
        const current = Math.max(job.progress, node.progress ?? 0)
        const step = current < 55 ? 2 + Math.random() * 2 : current < 80 ? .8 + Math.random() * 1.4 : .2 + Math.random() * .55
        node.progress = Math.min(92, Math.round((current + step) * 10) / 10)
      } else node.progress = job.progress
      updateEditor(); draw()
      if (job.status === 'succeeded' || job.status === 'failed') {
        window.clearInterval(timer); activeJobPolls.delete(jobId)
        if (job.status === 'succeeded' && job.result_url) { node.mediaUrl = job.result_url; node.body = '生成完成 · 结果已回写'; imageCache.delete(job.result_url) }
        if (job.status === 'failed') jobLabel.textContent = job.error ? `生成失败：${job.error}` : '生成失败'
        updateEditor(); draw(); scheduleSave()
      }
    } catch { failures++; jobLabel.textContent = failures < 5 ? '状态同步中断，正在重试…' : '状态查询失败'; if (failures >= 5) { window.clearInterval(timer); activeJobPolls.delete(jobId) } }
  }, 650)
  activeJobPolls.set(jobId, timer)
}

canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; hideContextMenu(); if (cameraFrame !== null) { cancelAnimationFrame(cameraFrame); cameraFrame = null; zoomTarget = camera.zoom } pointer.down = true; pointer.x = e.clientX; pointer.y = e.clientY; const port = hitPort(e.clientX, e.clientY); if (port) { connecting = { nodeId: port.node.id, side: port.side, pointer: { x: e.clientX, y: e.clientY } }; selectedId = port.node.id; pointer.draggingNode = null; updateEditor() } else { const node = hitNode(e.clientX, e.clientY); pointer.draggingNode = node && node.status !== 'queued' && node.status !== 'running' ? node.id : null; if (node) selectedId = node.id; else selectedId = 0; updateEditor() } canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); draw() })
canvas.addEventListener('pointermove', e => { if (!pointer.down) return; setSaveState('editing', '编辑中…'); if (connecting) { connecting.pointer = { x: e.clientX, y: e.clientY }; draw(); return } const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (pointer.draggingNode) { const node = nodes.find(n => n.id === pointer.draggingNode)!; node.x += dx / camera.zoom; node.y += dy / camera.zoom } else { camera.x += dx; camera.y += dy } pointer.x = e.clientX; pointer.y = e.clientY; draw() })
canvas.addEventListener('pointerup', e => { if (connecting) { const target = hitPort(e.clientX, e.clientY); if (target && target.node.id !== connecting.nodeId) { const duplicate = links.some(link => link.from === connecting!.nodeId && link.to === target.node.id && link.fromSide === connecting!.side && link.toSide === target.side); if (!duplicate) links.push({ from: connecting.nodeId, to: target.node.id, fromSide: connecting.side, toSide: target.side }) } connecting = null } scheduleSave(); pointer.down = false; pointer.draggingNode = null; canvas.classList.remove('dragging'); draw() })
canvas.addEventListener('wheel', e => { e.preventDefault(); smoothZoom(zoomTarget * Math.exp(-e.deltaY * .001), { x: e.clientX, y: e.clientY }) }, { passive: false })
canvas.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, hitNode(e.clientX, e.clientY)) })
document.querySelector('#reset')!.addEventListener('click', fitCanvas)
zoomSlider.addEventListener('input', () => { zoomTarget = Number(zoomSlider.value) / 100; setZoom(zoomTarget, { x: innerWidth / 2, y: innerHeight / 2 }) })
document.querySelector('#zoom-in')!.addEventListener('click', () => smoothZoom(zoomTarget * 1.15, { x: innerWidth / 2, y: innerHeight / 2 }))
document.querySelector('#zoom-out')!.addEventListener('click', () => smoothZoom(zoomTarget / 1.15, { x: innerWidth / 2, y: innerHeight / 2 }))
document.querySelector('#quick-create')!.addEventListener('click', () => addNode('image'))
generateButton.addEventListener('click', generate)
document.querySelector('#delete-node')!.addEventListener('click', deleteSelectedNode)
document.querySelector('#context-delete')!.addEventListener('click', () => { if (contextNodeId !== null) selectedId = contextNodeId; deleteSelectedNode(); hideContextMenu() })
titleInput.addEventListener('input', () => { const node = selectedNode(); if (!node) return; node.title = titleInput.value; scheduleSave(); draw() })
promptInput.addEventListener('input', () => { const node = selectedNode(); if (!node) return; node.body = promptInput.value; scheduleSave(); draw() })
modelInput.addEventListener('change', () => { const node = selectedNode(); if (!node) return; node.model = modelInput.value; scheduleSave(); draw() })
document.querySelectorAll<HTMLElement>('[data-add]').forEach(button => button.addEventListener('click', () => addNode(button.dataset.add as NodeKind)))
document.querySelectorAll<HTMLElement>('[data-context-add]').forEach(button => button.addEventListener('click', () => { addNode(button.dataset.contextAdd as NodeKind, contextPosition); hideContextMenu() }))
const appearanceButton = document.querySelector<HTMLButtonElement>('#dock-appearance')!
let themeTransitioning = false
function refreshAppearanceButton() { appearanceButton.disabled = themeTransitioning || pendingMediaLoads.size > 0; appearanceButton.title = pendingMediaLoads.size ? `等待 ${pendingMediaLoads.size} 个图片资源加载完成` : '切换画布外观' }
const themeLockDuration = 1400
function releaseThemeLock(startedAt: number) {
  const remaining = Math.max(0, themeLockDuration - (performance.now() - startedAt))
  window.setTimeout(() => { sessionStorage.removeItem('flow-theme-transition-inflight'); themeTransitioning = false; refreshAppearanceButton(); clientLog('theme-transition-complete', { duration: Math.round(performance.now() - startedAt), theme: colorTheme }) }, remaining)
}
appearanceButton.addEventListener('click', () => {
  if (themeTransitioning) return
  const transitionStartedAt = performance.now()
  themeTransitioning = true
  appearanceButton.disabled = true
  sessionStorage.setItem('flow-theme-transition-inflight', JSON.stringify({ startedAt: Date.now(), from: colorTheme, projectId: currentProjectId }))
  clientLog('theme-transition-start', { from: colorTheme, projectId: currentProjectId, mediaCount: nodes.filter(node => node.mediaUrl).length })
  const rect = appearanceButton.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  document.documentElement.style.setProperty('--theme-x', `${x}px`)
  document.documentElement.style.setProperty('--theme-y', `${y}px`)
  document.documentElement.style.setProperty('--theme-radius', `${radius}px`)
  const applyTheme = () => {
    colorTheme = colorTheme === 'dark' ? 'light' : 'dark'
    document.body.dataset.theme = colorTheme
    localStorage.setItem('flow-theme', colorTheme)
    repaintAllMedia()
    paint()
  }
  if (/Edg\//.test(navigator.userAgent)) {
    clientLog('theme-transition-edge-native-disabled', { reason: 'renderer-crash-code-5', from: colorTheme })
    document.body.classList.add('edge-theme-fade')
    window.setTimeout(() => {
      applyTheme(); document.documentElement.style.background = colorTheme === 'dark' ? '#181715' : '#f4f2ed'
      document.body.classList.add('edge-theme-return'); document.body.classList.remove('edge-theme-fade')
      window.setTimeout(() => { document.body.classList.remove('edge-theme-return'); releaseThemeLock(transitionStartedAt) }, 160)
    }, 130)
    return
  }
  const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void> } }
  if (!transitionDocument.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme()
    releaseThemeLock(transitionStartedAt)
    return
  }
  try {
    const transition = transitionDocument.startViewTransition(applyTheme)
    transition.ready.then(() => {
      document.documentElement.animate([
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ], { duration: 560, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'both', pseudoElement: '::view-transition-new(root)' } as KeyframeAnimationOptions)
    }).catch(error => clientLog('theme-transition-ready-failed', { message: error instanceof Error ? error.message : String(error) }))
    transition.finished.catch(error => clientLog('theme-transition-finished-failed', { message: error instanceof Error ? error.message : String(error) })).finally(() => releaseThemeLock(transitionStartedAt))
  } catch (error) {
    clientLog('theme-transition-start-failed', { message: error instanceof Error ? error.message : String(error) })
    applyTheme()
    releaseThemeLock(transitionStartedAt)
  }
})
document.querySelector('#dock-clear')!.addEventListener('click', () => { if (!nodes.length || !window.confirm('确定清除当前画布中的全部节点和连线吗？')) return; nodes.splice(0); links.splice(0); selectedId = 0; updateEditor(); scheduleSave(); draw() })
const panelBackdrop = document.querySelector<HTMLElement>('#panel-backdrop')!
const workspacePanels = document.querySelectorAll<HTMLElement>('.workspace-panel')
function closeWorkspacePanels() { workspacePanels.forEach(panel => panel.classList.remove('open')); panelBackdrop.classList.remove('open'); document.querySelectorAll('.main-nav button').forEach(button => button.classList.remove('active')) }
function openWorkspacePanel(id: string, trigger: string) { closeWorkspacePanels(); document.querySelector<HTMLElement>(id)!.classList.add('open'); panelBackdrop.classList.add('open'); document.querySelector<HTMLElement>(trigger)!.classList.add('active') }
document.querySelector('#open-projects')!.addEventListener('click', () => { openWorkspacePanel('#projects-panel', '#open-projects'); void loadProjects() })
document.querySelector('#open-assets')!.addEventListener('click', () => { openWorkspacePanel('#assets-panel', '#open-assets'); void loadAssets() })
document.querySelectorAll('.panel-close').forEach(button => button.addEventListener('click', closeWorkspacePanels))
panelBackdrop.addEventListener('click', closeWorkspacePanels)
const assetUpload = document.querySelector<HTMLInputElement>('#asset-upload')!, assetGrid = document.querySelector<HTMLElement>('#asset-grid')!, assetCount = document.querySelector<HTMLElement>('#asset-count')!
const assetPreview = document.querySelector<HTMLElement>('#asset-preview')!, previewImage = document.querySelector<HTMLImageElement>('#preview-image')!, previewName = document.querySelector<HTMLElement>('#preview-name')!
let contextUploadPosition: Point | null = null
let draggingAsset: { url: string; name: string } | null = null
let selectedAsset: { id: string; url: string; name: string } | null = null
const assetContextMenu = document.querySelector<HTMLElement>('#asset-context-menu')!
document.querySelector('#upload-assets')!.addEventListener('click', () => assetUpload.click())
document.querySelector('#dock-upload')!.addEventListener('click', () => assetUpload.click())
document.querySelector('#context-upload')!.addEventListener('click', () => { contextUploadPosition = { ...contextPosition }; assetUpload.accept = 'image/*'; assetUpload.multiple = false; hideContextMenu(); assetUpload.click() })
document.querySelector('#context-assets')!.addEventListener('click', () => { hideContextMenu(); openWorkspacePanel('#assets-panel', '#open-assets'); void loadAssets() })
document.querySelector('#context-url')!.addEventListener('click', () => { const position = { ...contextPosition }; hideContextMenu(); const value = window.prompt('请输入图片 URL（http:// 或 https://）')?.trim(); if (!value) return; try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); addMediaNode(url.href, 'URL 图片', position) } catch { window.alert('请输入有效的 http:// 或 https:// 图片地址') } })
document.querySelector('#new-project')!.addEventListener('click', async () => { const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `未命名项目 ${document.querySelectorAll('.project-card').length + 1}` }) }); if (response.ok) { const project = await response.json() as { id: string }; await switchProject(project.id); await loadProjects() } })
assetUpload.addEventListener('change', async () => { const files = [...(assetUpload.files ?? [])]; if (!files.length) return; const button = document.querySelector<HTMLButtonElement>('#upload-assets')!, placement = contextUploadPosition; contextUploadPosition = null; button.disabled = true; button.textContent = '正在上传…'; try { const payload = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || 'application/octet-stream', data: await fileBase64(file) }))); const response = await fetch(`/api/projects/${currentProjectId}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: payload }) }); if (!response.ok) throw new Error(response.status === 413 ? '图片过大，单个文件不能超过 100MB' : `上传失败（${response.status}）`); const uploaded = await response.json() as Array<{ name: string; mimeType: string; url: string }>; if (placement && uploaded[0]?.mimeType.startsWith('image/')) addMediaNode(uploaded[0].url, uploaded[0].name, placement); await loadAssets() } catch (error) { window.alert(error instanceof Error ? error.message : '上传失败，请重试') } finally { button.disabled = false; button.textContent = '↑ 上传图片或视频'; assetUpload.value = ''; assetUpload.accept = 'image/*,video/*'; assetUpload.multiple = true } })
async function loadProjects() { const response = await fetch('/api/projects'); if (!response.ok) return; const projects = await response.json() as Array<{ id: string; name: string; updatedAt: string }>; const list = document.querySelector<HTMLElement>('#project-list')!; list.innerHTML = ''; for (const project of projects) { const button = document.createElement('button'); button.className = `project-card${project.id === currentProjectId ? ' active' : ''}`; button.type = 'button'; button.innerHTML = `<i>∞</i><span><strong>${escapeHtml(project.name)}</strong><small>${project.id === currentProjectId ? '当前画布' : '已自动保存'}</small></span><b>进入</b>`; button.addEventListener('click', () => void switchProject(project.id)); list.append(button) } }
async function switchProject(projectId: string) { if (projectId === currentProjectId) { closeWorkspacePanels(); return } await saveCanvas(); currentProjectId = projectId; localStorage.setItem('flow-project-id', projectId); await loadCanvas(); await loadAssets(); closeWorkspacePanels() }
async function loadAssets() { const response = await fetch(`/api/projects/${currentProjectId}/assets`); if (!response.ok) return; const assets = await response.json() as Array<{ id: string; name: string; mimeType: string; url: string }>; assetCount.textContent = `${assets.length} 项`; assetGrid.innerHTML = assets.length ? '' : '<div class="asset-empty"><b>◇</b><span>还没有素材</span><small>上传后可用于图生图与视频生成</small></div>'; for (const asset of assets) { const item = document.createElement('div'); item.className = 'asset-item'; item.innerHTML = asset.mimeType.startsWith('video/') ? `<video src="${asset.url}" muted draggable="false"></video><span>${escapeHtml(asset.name)}</span>` : `<img src="${asset.url}" alt="" draggable="false"><span>${escapeHtml(asset.name)}</span>`; item.draggable = false; if (asset.mimeType.startsWith('image/')) { item.title = '单击放到画布 · 右击查看更多'; item.addEventListener('click', () => { addMediaNode(asset.url, asset.name, world({ x: innerWidth / 2, y: innerHeight / 2 })); closeWorkspacePanels() }); item.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); selectedAsset = { id: asset.id, url: asset.url, name: asset.name }; assetContextMenu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`; assetContextMenu.style.top = `${Math.min(event.clientY, innerHeight - 155)}px`; assetContextMenu.classList.add('open') }) } assetGrid.append(item) } }
function openAssetPreview(url: string, name: string) { previewImage.src = url; previewImage.alt = name; previewName.textContent = name; assetPreview.classList.add('open') }
function closeAssetPreview() { assetPreview.classList.remove('open'); previewImage.removeAttribute('src') }
document.querySelector('#close-preview')!.addEventListener('click', closeAssetPreview)
assetPreview.addEventListener('click', event => { if (event.target === assetPreview) closeAssetPreview() })
document.querySelector('#asset-context-place')!.addEventListener('click', () => { if (selectedAsset) addMediaNode(selectedAsset.url, selectedAsset.name, world({ x: innerWidth / 2, y: innerHeight / 2 })); assetContextMenu.classList.remove('open'); closeWorkspacePanels() })
document.querySelector('#asset-context-preview')!.addEventListener('click', () => { if (selectedAsset) openAssetPreview(selectedAsset.url, selectedAsset.name); assetContextMenu.classList.remove('open') })
document.querySelector('#asset-context-delete')!.addEventListener('click', async () => { if (!selectedAsset || !window.confirm(`确定删除“${selectedAsset.name}”吗？`)) return; const response = await fetch(`/api/assets/${selectedAsset.id}`, { method: 'DELETE' }); if (!response.ok) { window.alert('删除失败，请重试'); return } imageCache.delete(selectedAsset.url); selectedAsset = null; assetContextMenu.classList.remove('open'); await loadAssets() })
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = draggingAsset ? 'copy' : 'none' })
document.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); if (!draggingAsset) return; const asset = draggingAsset; draggingAsset = null; closeWorkspacePanels(); addMediaNode(asset.url, asset.name, world({ x: event.clientX, y: event.clientY })) })
function escapeHtml(value: string) { const element = document.createElement('span'); element.textContent = value; return element.innerHTML }
function fileBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }) }
document.addEventListener('pointerdown', event => {
  const target = event.target as Node
  if (!contextMenu.contains(target) && target !== canvas) hideContextMenu()
  if (!assetContextMenu.contains(target)) assetContextMenu.classList.remove('open')
  document.querySelectorAll<HTMLDetailsElement>('.image-config-panel details[open]').forEach(details => { if (!details.contains(target)) details.open = false })
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nodeInfoModal.classList.contains('open')) { closeNodeInfo(); return }
  if (event.key === 'Escape' && assetPreview.classList.contains('open')) { closeAssetPreview(); return }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault(); deleteSelectedNode()
})
window.addEventListener('resize', resize); resize(); updateEditor(); void loadCanvas()
