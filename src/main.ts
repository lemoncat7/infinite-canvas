import './style.css'

type Point = { x: number; y: number }
type NodeKind = 'prompt' | 'image' | 'video' | 'note'
type PortSide = 'top' | 'right' | 'bottom' | 'left'
type FlowNode = Point & { id: number; publicId?: string; kind: NodeKind; role?: 'generator' | 'result'; sourceNodeId?: number; width: number; height: number; title: string; body: string; generationPrompt?: string; accent: string; model?: string; jobId?: string; progress?: number; status?: string; mediaUrl?: string; fontScale?: number; agentAuto?:boolean; comicData?:unknown; imageSettings?: { size?: string; quality?: string; background?: string }; videoSettings?: { seconds?: string; resolution?: string; aspectRatio?: string } }
type FlowLink = { from: number; to: number; fromSide: PortSide; toSide: PortSide; inputOrder?: number }
type GenerationCapabilities = { image?: { defaultModel: string; localFallback?: { model:string; available:boolean } }; video?: { defaultModel: string; seconds: { min: number; max: number; default: number }; resolutions: string[]; aspectRatios: string[] } }
let generationCapabilities: GenerationCapabilities = { image: { defaultModel: 'gpt-image-2' }, video: { defaultModel: 'agnes-video-v2.0', seconds: { min: 1, max: 18, default: 5 }, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1', '4:3', '16:9'] } }

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
document.querySelector<HTMLElement>('.brand')!.append(saveState)
const taskMonitorButton=document.createElement('button'),taskMonitorPanel=document.createElement('section');taskMonitorButton.type='button';taskMonitorButton.className='task-monitor-button';taskMonitorButton.setAttribute('aria-label','项目生成任务');taskMonitorButton.innerHTML='<i></i><span>任务</span><b>0</b><small>暂无任务</small>';const resetButton=document.querySelector<HTMLElement>('#reset')!;resetButton.parentElement!.insertBefore(taskMonitorButton,resetButton);taskMonitorPanel.className='task-monitor-panel';taskMonitorPanel.innerHTML='<header><span><b>项目任务</b><small>当前画布生成状态</small></span><button type="button" aria-label="关闭">×</button></header><div data-task-list></div>';document.body.append(taskMonitorPanel);taskMonitorPanel.querySelector<HTMLElement>('[data-task-list]')!.addEventListener('pointerup',event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-task-node]');if(button)focusTaskNode(Number(button.dataset.taskNode))})
const startEmptyImagesButton=document.createElement('button');startEmptyImagesButton.type='button';startEmptyImagesButton.className='start-empty-images-button';startEmptyImagesButton.setAttribute('aria-label','一键启动所有空图任务');startEmptyImagesButton.innerHTML='<span>✦</span><strong>启动空图</strong><b>0</b>';taskMonitorButton.parentElement!.insertBefore(startEmptyImagesButton,taskMonitorButton)
taskMonitorPanel.insertAdjacentHTML('beforeend','<footer><button type="button" data-start-empty-mobile disabled>启动空图 · 0</button><button type="button" data-cancel-pending disabled>取消等待任务</button></footer>')
const jobLabel = document.querySelector<HTMLSpanElement>('#job-label')!
const jobProgress = document.querySelector<HTMLElement>('#job-progress')!
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!
const camera = { x: 80, y: 10, zoom: 0.9 }
const pointer = { down: false, x: 0, y: 0, draggingNode: null as number | null }
let selectedId = 0
const batchSelectedIds=new Set<number>()
let marquee:{pointerId:number;start:Point;worldStart:Point;current:Point;active:boolean;baseSelection:Set<number>}|null=null,marqueeAutoPanFrame=0,marqueeContextSuppressedUntil=0,multiSelectMode=false,marqueeMode=false,marqueeHoldTimer:number|undefined,marqueeHoldPointer:{id:number;start:Point;pointerType:string}|null=null
let editingTextNodeId = 0
let nextId = 1
let contextPosition: Point = { x: 0, y: 0 }
let connecting: { nodeId: number; side: PortSide; pointer: Point } | null = null
const connectionSnapRadius=48
let connectionSnap: { nodeId: number; side: PortSide } | null = null
let hoveredLinkIndex = -1
let touchSelectedLinkIndex = -1
let touchLinkGesture:{pointerId:number;start:Point;index:number;moved:boolean}|null=null
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
let domDrag: { id: number; pointerId: number; startX: number; startY: number; initialX: number; initialY: number; element: HTMLElement; moved: boolean; agentSelect?:boolean } | null = null
let domDragFrame: number | null = null
let suppressNodeReleaseUntil = 0
let domResize: { id: number; startX: number; startY: number; width: number; height: number } | null = null

const nodes: FlowNode[] = []
const links: FlowLink[] = []
let taskMonitorSignature=''
function taskStatus(node:FlowNode){if(node.status==='running')return{order:0,label:`生成中${Number(node.progress??0)>0?` ${Math.round(node.progress??0)}%`:''}`,className:'running'};if(node.status==='queued')return{order:1,label:'排队中',className:'queued'};if(node.agentAuto&&node.status==='waiting')return{order:2,label:'等待上游',className:'waiting'};if(node.status==='failed')return{order:3,label:'生成失败',className:'failed'};return null}
function updateCancelPendingButton(){const count=nodes.filter(node=>node.status==='queued'||(node.agentAuto&&node.status==='waiting')).length,button=taskMonitorPanel.querySelector<HTMLButtonElement>('[data-cancel-pending]')!;button.disabled=count===0;button.textContent=count?`取消等待任务 · ${count}`:'没有等待任务'}
function emptyImageCandidates(){return nodes.filter(node=>node.kind==='image'&&!node.mediaUrl&&node.role!=='result'&&canGenerateNode(node)&&node.status!=='queued'&&node.status!=='running'&&node.status!=='waiting'&&!node.agentAuto)}
function updateStartEmptyImagesButton(){const count=emptyImageCandidates().length,mobileButton=taskMonitorPanel.querySelector<HTMLButtonElement>('[data-start-empty-mobile]')!;startEmptyImagesButton.querySelector('b')!.textContent=String(count);startEmptyImagesButton.disabled=count===0;startEmptyImagesButton.classList.toggle('ready',count>0);startEmptyImagesButton.title=count?`将 ${count} 个没有图片的节点加入生成队列`:'当前没有可启动的空图节点';mobileButton.disabled=count===0;mobileButton.textContent=count?`启动空图 · ${count}`:'暂无可生成空图';mobileButton.classList.toggle('ready',count>0)}
function startAllEmptyImages(){const candidates=emptyImageCandidates();if(!candidates.length){showCanvasGuide({key:'empty-images-none',title:'没有可启动的空图',detail:'已有图片、提示词为空或已经进入任务的节点会被自动跳过。',tone:'online',duration:2800});return}candidates.forEach(node=>{node.agentAuto=true;node.status='waiting'});const ready=candidates.filter(node=>!links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).some(upstream=>upstream?.kind==='image'&&!upstream.mediaUrl)).length,waiting=candidates.length-ready;scheduleSave();draw();runAgentWorkflow();showCanvasGuide({key:'empty-images-started',title:`已启动 ${candidates.length} 个空图任务`,detail:`${ready} 个立即进入队列${waiting?`，${waiting} 个将在上游图片完成后自动继续`:''}。可在旁边的“任务”中查看进度。`,tone:'online',duration:5200})}
async function cancelPendingProjectTasks(){const localWaiting=nodes.filter(node=>node.agentAuto&&node.status==='waiting'),queued=nodes.filter(node=>node.status==='queued');if(!localWaiting.length&&!queued.length)return;const confirmed=await askProjectDialog({title:'取消所有等待任务？',description:`将取消 ${queued.length} 个排队任务和 ${localWaiting.length} 个等待上游任务，已经生成中的任务不会受到影响。`,confirm:'一键取消'});if(!confirmed)return;try{const response=await fetch(`/api/projects/${currentProjectId}/jobs/cancel-pending`,{method:'POST'}),result=await response.json() as {canceled?:number;ids?:string[];error?:string};if(!response.ok)throw new Error(result.error||'取消失败');const canceledIds=new Set(result.ids||[]);localWaiting.forEach(node=>{node.agentAuto=false;node.status='idle';node.progress=0});for(const jobId of canceledIds){const timer=activeJobPolls.get(jobId);if(timer)window.clearInterval(timer);activeJobPolls.delete(jobId)}for(let index=nodes.length-1;index>=0;index--){const node=nodes[index];if(!node.jobId||!canceledIds.has(node.jobId))continue;if(node.role==='result'||node.title==='图片修改结果'){const id=node.id;nodes.splice(index,1);for(let linkIndex=links.length-1;linkIndex>=0;linkIndex--)if(links[linkIndex].from===id||links[linkIndex].to===id)links.splice(linkIndex,1)}else{delete node.jobId;node.status='idle';node.progress=0;node.agentAuto=false}}try{const userResponse=await fetch('/api/users/me');if(userResponse.ok){authUser=await userResponse.json() as AuthUser;renderAuthenticatedUser();refreshNodeModelMenus()}}catch{/* 稍后同步 */}scheduleSave();updateEditor();draw();showToast(`已取消 ${(result.canceled||0)+localWaiting.length} 个等待任务`,'success')}catch(error){showToast('取消等待任务失败','error',error instanceof Error?error.message:'请稍后重试')}}
function focusTaskNode(nodeId:number){const node=nodes.find(item=>item.id===nodeId);if(!node)return;selectedId=node.id;camera.x=-(node.x+node.width/2)*camera.zoom;camera.y=-(node.y+node.height/2)*camera.zoom;taskMonitorPanel.classList.remove('open');updateEditor();draw()}
function updateTaskMonitor(){const tasks=nodes.map(node=>({node,status:taskStatus(node)})).filter((item):item is {node:FlowNode;status:NonNullable<ReturnType<typeof taskStatus>>}=>Boolean(item.status)).sort((left,right)=>left.status.order-right.status.order||left.node.id-right.node.id),running=tasks.filter(item=>item.status.className==='running').length,queued=tasks.filter(item=>item.status.className==='queued').length,waiting=tasks.filter(item=>item.status.className==='waiting').length,signature=tasks.map(item=>`${item.node.id}:${item.node.status}:${item.node.title}:${item.node.model}`).join('|');updateStartEmptyImagesButton();taskMonitorButton.classList.toggle('active',running+queued>0);taskMonitorButton.querySelector('b')!.textContent=String(running+queued);taskMonitorButton.querySelector('small')!.textContent=`${running?`生成中 ${running}`:''}${running&&queued?' · ':''}${queued?`排队 ${queued}`:''}${!running&&!queued?'暂无任务':''}`;taskMonitorPanel.querySelector<HTMLElement>('header small')!.textContent=`生成中 ${running} · 排队 ${queued} · 等待上游 ${waiting}`;if(signature!==taskMonitorSignature){taskMonitorSignature=signature;const list=taskMonitorPanel.querySelector<HTMLElement>('[data-task-list]')!,scrollTop=list.scrollTop;list.innerHTML=tasks.length?tasks.slice(0,30).map(({node,status})=>`<button type="button" data-task-node="${node.id}"><i class="${status.className}">${node.kind==='video'?'▶':'▧'}</i><span><b>${escapeHtml(node.title||'未命名任务')}</b><small>${escapeHtml(modelDisplayName(node.model)||'默认模型')}</small></span><em>${status.label}</em></button>`).join(''):'<div class="task-monitor-empty"><b>✓</b><span>当前没有生成任务</span></div>';list.scrollTop=scrollTop}else tasks.forEach(({node,status})=>{const label=taskMonitorPanel.querySelector<HTMLElement>(`[data-task-node="${node.id}"] > em`);if(label)label.textContent=status.label})}
startEmptyImagesButton.addEventListener('click',startAllEmptyImages)
taskMonitorPanel.querySelector('[data-start-empty-mobile]')!.addEventListener('click',()=>{startAllEmptyImages();taskMonitorPanel.classList.remove('open')})
function closeTopbarMenus(except?:'workspace'|'task'|'user'|'notifications'){if(except!=='task')taskMonitorPanel.classList.remove('open');if(except!=='user')workspaceUserMenu.classList.remove('open');if(except!=='notifications')notificationModal.classList.remove('open');if(except!=='workspace')closeMobileWorkspaceMenu()}
taskMonitorButton.addEventListener('click',event=>{event.stopPropagation();const opening=!taskMonitorPanel.classList.contains('open');closeTopbarMenus(opening?'task':undefined);if(!opening)return;const rect=taskMonitorButton.getBoundingClientRect();taskMonitorPanel.style.top=`${rect.bottom+8}px`;taskMonitorPanel.style.right=`${Math.max(12,innerWidth-rect.right)}px`;taskMonitorPanel.classList.add('open')});taskMonitorPanel.querySelector('header button')!.addEventListener('click',()=>taskMonitorPanel.classList.remove('open'));taskMonitorPanel.querySelector('[data-cancel-pending]')!.addEventListener('click',()=>void cancelPendingProjectTasks());taskMonitorPanel.addEventListener('click',event=>event.stopPropagation())
document.addEventListener('click',()=>taskMonitorPanel.classList.remove('open'))
const marqueeBox=document.createElement('div'),batchToolbar=document.createElement('div');marqueeBox.className='canvas-marquee';batchToolbar.className='canvas-batch-toolbar';batchToolbar.innerHTML='<span data-batch-count>已选 0 项</span><button type="button" data-batch-generate aria-label="生成所选卡片" title="生成">生成</button><button type="button" data-batch-delete aria-label="删除所选卡片" title="删除">删除</button><button type="button" data-batch-clear aria-label="退出多选模式" title="退出">退出</button>';document.body.append(marqueeBox,batchToolbar)
let promptAgentContextSelection = new Set<number>()
let promptAgentSelecting = false
let saveTimer: number | undefined
let drawFrame: number | null = null
let cameraFrame: number | null = null
let zoomTarget = camera.zoom
let zoomAnchor: Point = { x: innerWidth / 2, y: innerHeight / 2 }
const canvasTouches = new Map<number, Point>()
let pinchGesture: { distance:number; center:Point } | null = null
const imageCache = new Map<string, HTMLImageElement>()
const pendingMediaLoads = new Set<string>()
function modelDisplayName(value?: string) { if (!value?.startsWith('custom:')) return value || ''; return customApiModels.find(item => `custom:${item.id}` === value)?.name || '自定义模型' }
const activeJobPolls = new Map<string, number>()
const retryNotifiedJobs = new Set<string>()
const toastStack = document.querySelector<HTMLElement>('#toast-stack')!
function friendlyGenerationError(raw: string, fallback: string) {
  const text = raw.trim() || fallback, lower = text.toLowerCase(), requestId = text.match(/request id\s*[:：]?\s*([a-z0-9-]+)/i)?.[1]
  if (/safety system|content.?policy|safety_violations|安全(?:系统|检查)|内容政策/.test(lower)) return { title:'图片未通过安全检查', message:'提示词或参考图片可能触发了内容安全规则。', advice:'尝试使用更中性的描述，移除危险动作；如果使用了参考图，请逐张排查或更换图片。', requestId }
  if (/\b401\b|unauthorized|invalid api key|incorrect api key|鉴权|密钥.*(?:无效|错误)/.test(lower)) return { title:'接口认证失败', message:'当前 API 密钥无效、已过期或没有该模型权限。', advice:'请检查接口地址、密钥和模型权限后重试。', requestId }
  if (/\b403\b|forbidden|permission denied|无权限/.test(lower)) return { title:'接口没有访问权限', message:'当前账号或密钥无权执行这项生成任务。', advice:'检查模型授权、账号权限或代理服务配置。', requestId }
  if (/\b429\b|rate.?limit|too many requests|quota|额度|请求过多/.test(lower)) return { title:'请求过于频繁', message:'生成接口当前繁忙，或账号额度已经用完。', advice:'稍后重试，并检查接口额度与并发限制。', requestId }
  if (/auth_unavailable|no auth available/.test(lower)) return { title:'CPA 暂无可用账号', message:'CPA 的生图认证池当前没有可用账号。', advice:'暂停重复提交，等待账号冷却后再试，或检查 CPA 的 Codex 认证状态。', requestId }
  if (/unexpected eof|backend-api\/codex\/images/.test(lower)) return { title:'CPA 生图连接中断', message:'CPA 请求上游图片接口时连接被提前断开。', advice:'这不是素材顺序错误；等待 CPA 恢复后重试，持续出现时请检查 CPA 日志和账号状态。', requestId }
  if (/timeout|timed out|aborted due to timeout|超时/.test(lower)) return { title:'生成等待时间过长', message:'接口在限定时间内没有返回完整结果。', advice:'稍后重试；复杂提示词可以切换为简洁模式，并减少参考图片数量。', requestId }
  if (/download.*image|image.*download|读取.*图片|参考图片.*(?:读取|下载)|首帧图片/.test(lower)) return { title:'参考图片读取失败', message:'生成服务暂时无法访问其中一张参考图片。', advice:'重新上传图片、检查公网地址，或稍后再试。', requestId }
  if (/未返回任务 id|没有.*task.?id|without.*(?:task|request).*id/.test(lower)) return { title:'接口格式不兼容', message:'视频接口没有返回可用于查询进度的任务编号。', advice:'检查所选模型与 Provider 适配方式是否匹配。', requestId }
  if (/\b5\d\d\b|bad gateway|service unavailable|internal server error|upstream/.test(lower)) return { title:'生成服务暂时异常', message:'上游接口当前不可用或返回了服务端错误。', advice:'稍后重试；如果持续发生，请检查 CPA 或模型服务日志。', requestId }
  return { title:'生成失败', message:fallback || '任务未能完成。', advice:'可以重试一次；若仍然失败，请展开技术详情查看接口返回。', requestId }
}
function showToast(message: string, type: 'error' | 'success' | 'warning' = 'error', detail = '') {
  const toast = document.createElement('div'), raw = detail || message, friendly = type === 'error' ? friendlyGenerationError(raw, message) : null
  toast.className = `app-toast ${type}`
  toast.innerHTML = `<i>${type === 'error' ? '!' : type === 'success' ? '✓' : 'i'}</i><span><b>${escapeHtml(friendly?.title || (type === 'success' ? '生成完成' : type === 'warning' ? '提示' : '生成失败'))}</b><small>${escapeHtml(friendly?.message || message)}</small>${friendly ? `<p>${escapeHtml(friendly.advice)}</p><details><summary>技术详情</summary><em>${escapeHtml(raw)}${friendly.requestId ? `\nRequest ID: ${escapeHtml(friendly.requestId)}` : ''}</em></details>` : detail ? `<em>${escapeHtml(detail)}</em>` : ''}</span><button type="button" aria-label="关闭">×</button>`
  let timer = window.setTimeout(() => toast.remove(), type === 'error' ? 20000 : 6000)
  toast.querySelector('button')!.addEventListener('click', () => { window.clearTimeout(timer); toast.remove() })
  toast.querySelector('details')?.addEventListener('toggle', event => { if ((event.currentTarget as HTMLDetailsElement).open) window.clearTimeout(timer); else timer = window.setTimeout(() => toast.remove(), 12000) })
  toastStack.append(toast); while (toastStack.children.length > 3) toastStack.firstElementChild?.remove()
}

function normalizePromptText(prompt?:string){let value=prompt?.trim()||'';if(!value)return'';const blocks=value.split(/\n{2,}/).map(item=>item.trim()).filter(Boolean);if(blocks.length%2===0&&blocks.slice(0,blocks.length/2).join('\n\n')===blocks.slice(blocks.length/2).join('\n\n'))value=blocks.slice(0,blocks.length/2).join('\n\n');const lines=value.split('\n'),cleaned:string[]=[];for(const line of lines){if(line.trim()&&line.trim()===cleaned.at(-1)?.trim())continue;cleaned.push(line)}return cleaned.join('\n').trim()}
async function copyOriginalPrompt(prompt?: string) {
  const value = normalizePromptText(prompt)
  if (!value) { showToast('暂无可复制的原提示词', 'warning'); return }
  try {
    await navigator.clipboard.writeText(value)
    showToast('原提示词已复制', 'success')
  } catch {
    showToast('复制失败，请手动选择提示词', 'error')
  }
}

function appAssetFingerprint(root: Document) { return [...root.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[type="module"][src],link[rel="stylesheet"][href]')].map(element => element.getAttribute(element instanceof HTMLScriptElement ? 'src' : 'href') || '').filter(Boolean).sort().join('|') }
const initialAppAssets = appAssetFingerprint(document)
let updateNoticeShown = false
type CanvasGuideTone = 'neutral' | 'online' | 'offline'
type CanvasGuideAction = { label:string; primary?:boolean; run:()=>void }
type CanvasGuideMessage = { key:string; title:string; detail:string; tone?:CanvasGuideTone; priority?:number; duration?:number; actions?:CanvasGuideAction[] }
let canvasGuideBubble: HTMLElement | null = null
let canvasGuideKey = '', canvasGuidePriority = -1, canvasGuideTimer = 0, canvasGuideHideTimer = 0, canvasGuideFrame = 0
let serviceKnownOffline = false
function positionInspirationBubble(notice: HTMLElement) {
  const trigger = document.querySelector<HTMLElement>('#prompt-agent-trigger')
  if (!trigger || !notice.isConnected) return
  const icon = trigger.querySelector<HTMLElement>('b') || trigger
  const rect = icon.getBoundingClientRect()
  const anchorX = rect.left + rect.width / 2
  const gap = 34
  // Starting at the icon: small -> middle -> body travels up and to the right.
  const preferredTailX = 18
  const width = notice.offsetWidth
  const left = Math.max(12, Math.min(innerWidth - width - 12, anchorX - preferredTailX))
  const tailX = Math.max(10, Math.min(width - 10, anchorX - left))
  notice.style.left = `${left}px`
  notice.style.bottom = `${Math.max(12, innerHeight - rect.top + gap)}px`
  notice.style.setProperty('--bubble-tail-x', `${tailX}px`)
}
function followInspirationBubble(notice: HTMLElement) {
  if (canvasGuideFrame) cancelAnimationFrame(canvasGuideFrame)
  let previous = ''
  const follow = () => {
    if (!notice.isConnected || notice.hidden) { canvasGuideFrame = 0; return }
    const trigger = document.querySelector<HTMLElement>('#prompt-agent-trigger')
    const icon = trigger?.querySelector<HTMLElement>('b') || trigger
    if (icon) {
      const rect = icon.getBoundingClientRect()
      const signature = `${rect.left.toFixed(2)}:${rect.top.toFixed(2)}:${rect.width.toFixed(2)}:${notice.offsetWidth}`
      if (signature !== previous) { previous = signature; positionInspirationBubble(notice) }
    }
    canvasGuideFrame = requestAnimationFrame(follow)
  }
  canvasGuideFrame = requestAnimationFrame(follow)
}
function ensureCanvasGuideBubble() {
  if (canvasGuideBubble) return canvasGuideBubble
  canvasGuideBubble = document.createElement('aside')
  canvasGuideBubble.className = 'app-update-popover service-status-popover'
  canvasGuideBubble.hidden = true
  document.body.append(canvasGuideBubble)
  return canvasGuideBubble
}
function burstCanvasGuide(notice:HTMLElement){const rect=notice.getBoundingClientRect(),field=document.createElement('div');field.className='canvas-guide-particle-field';field.style.left=`${rect.left+rect.width/2}px`;field.style.top=`${rect.top+rect.height/2}px`;field.innerHTML=Array.from({length:24},()=>{const angle=Math.random()*Math.PI*2,distance=38+Math.random()*104,startX=(Math.random()-.5)*Math.min(84,rect.width*.34),startY=(Math.random()-.5)*Math.min(34,rect.height*.5),size=3+Math.random()*5;return `<i style="left:${startX}px;top:${startY}px;width:${size}px;height:${size}px;--guide-px:${Math.cos(angle)*distance}px;--guide-py:${Math.sin(angle)*distance*(.58+Math.random()*.55)}px;--guide-delay:${Math.random()*70}ms"></i>`}).join('');document.body.append(field);window.setTimeout(()=>field.remove(),860)}
function hideCanvasGuide(key?:string) {
  if (key && key !== canvasGuideKey) return
  window.clearTimeout(canvasGuideTimer); canvasGuideTimer = 0
  if (canvasGuideFrame) cancelAnimationFrame(canvasGuideFrame); canvasGuideFrame = 0
  canvasGuideKey = ''; canvasGuidePriority = -1
  if (canvasGuideBubble && !canvasGuideBubble.hidden) {
    window.clearTimeout(canvasGuideHideTimer)
    const leaving=canvasGuideBubble
    burstCanvasGuide(leaving)
    leaving.hidden=true
    leaving.classList.remove('is-entering','is-leaving')
  }
}
function showCanvasGuide(message:CanvasGuideMessage) {
  const priority = message.priority ?? 20
  const duration = message.duration ?? (priority <= 40 ? 2800 : 0)
  if (canvasGuideKey && canvasGuideKey !== message.key && priority < canvasGuidePriority) return false
  const notice = ensureCanvasGuideBubble()
  window.clearTimeout(canvasGuideTimer); canvasGuideTimer = 0
  window.clearTimeout(canvasGuideHideTimer); canvasGuideHideTimer = 0
  canvasGuideKey = message.key; canvasGuidePriority = priority
  notice.className = `app-update-popover service-status-popover ${message.tone ?? 'neutral'}${message.actions?.length ? ' interactive' : ''}`
  notice.innerHTML = `<span><b>${escapeHtml(message.title)}</b><small>${escapeHtml(message.detail)}</small>${message.actions?.length ? '<em></em>' : ''}</span>`
  const actions = notice.querySelector<HTMLElement>('em')
  message.actions?.forEach(action => { const button=document.createElement('button');button.type='button';button.textContent=action.label;if(action.primary)button.dataset.updateReload='';button.addEventListener('click',action.run);actions?.append(button) })
  notice.hidden = false
  notice.classList.remove('is-leaving','is-entering')
  void notice.offsetWidth
  notice.classList.add('is-entering')
  followInspirationBubble(notice)
  if (duration > 0) canvasGuideTimer=window.setTimeout(()=>hideCanvasGuide(message.key),duration)
  return true
}
async function checkForAppUpdate() {
  if (updateNoticeShown || !initialAppAssets || document.visibilityState === 'hidden') return
  try {
    const response = await fetch(`/?app-version=${Date.now()}`, { cache:'no-store', headers:{ 'cache-control':'no-cache' } })
    if (!response.ok) return
    const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html')
    const nextAssets = appAssetFingerprint(nextDocument)
    if (!nextAssets || nextAssets === initialAppAssets) return
    updateNoticeShown = showCanvasGuide({key:'app-update',title:'检测到服务器版本更新',detail:'刷新页面后即可使用最新版本。',priority:80,actions:[{label:'稍后',run:()=>hideCanvasGuide('app-update')},{label:'刷新生效',primary:true,run:()=>location.reload()}]})
  } catch { /* deployment may briefly reset the connection */ }
}
window.setTimeout(() => { void checkForAppUpdate(); window.setInterval(() => void checkForAppUpdate(), 30_000) }, 20_000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForAppUpdate() })

const homePage = document.querySelector<HTMLElement>('#home-page')!
const homeGallery = document.querySelector<HTMLElement>('#home-gallery')!
const homeLoginModal = document.querySelector<HTMLElement>('#home-login-modal')!
const homePreview = document.querySelector<HTMLElement>('#home-preview')!
type AuthUser = { id: string; name: string; username?: string; email: string; inviteCode?: string; createdAt: string; credits?: number; reservedCredits?: number; isAdmin?:boolean }
type CustomApiModel = { id:string; kind:'image'|'video'; name:string; model:string; baseUrl:string; hasKey:boolean; hasProxy:boolean }
type AppNotification = { id:string; title:string; content:string; type:string; createdAt:string; isRead:boolean }
let authUser: AuthUser | null = null
let customApiModels: CustomApiModel[] = []
let appNotifications: AppNotification[] = []
let autoPopupCheckedUserId = ''
let notificationStream: EventSource | null = null
let notificationStreamUserId = ''
let notificationServerVersion = ''
let notificationOfflineTimer = 0
let notificationFallbackTimer = 0
let serviceReachabilityFailures = 0
let authReady = false
let authMode: 'login' | 'register' = 'login'
let showcaseLoaded = false
const workspaceBootStatus=document.createElement('div');workspaceBootStatus.className='workspace-boot-status';workspaceBootStatus.innerHTML='<i></i><span>正在检测登录状态</span>';homePage.append(workspaceBootStatus)
function setWorkspaceBootStatus(message:string,visible=true){workspaceBootStatus.querySelector('span')!.textContent=message;workspaceBootStatus.classList.toggle('visible',visible&&location.hash==='#/canvas')}
function randomizeHomeTheme() { const theme = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'dark' : 'light'; homePage.dataset.homeTheme = theme; document.body.dataset.homeTheme = theme }
function applyAppRoute() {
  const home = location.hash !== '#/canvas' || !authUser
  const wasHome = document.body.classList.contains('home-mode')
  if (home && !wasHome) randomizeHomeTheme()
  document.body.classList.toggle('home-mode', home)
  if (home && !showcaseLoaded) void loadShowcase()
  if (!home) requestAnimationFrame(resize)
  if (authReady && location.hash === '#/canvas' && !authUser) openAuth('login')
}
function requestWorkspace() {
  if (authUser) void enterWorkspace()
  else openAuth('register')
}
function openAuth(mode: 'login' | 'register') { setAuthMode(mode); homeLoginModal.classList.add('open'); homeLoginModal.querySelector<HTMLInputElement>('input[name="email"]')!.focus() }
function setAuthMode(mode: 'login' | 'register') { authMode = mode; homeLoginModal.querySelectorAll<HTMLElement>('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === mode)); homeLoginModal.querySelectorAll<HTMLElement>('[data-register-field]').forEach(field => { field.hidden = mode !== 'register' }); const name = homeLoginModal.querySelector<HTMLInputElement>('input[name="name"]')!, inviteCode = homeLoginModal.querySelector<HTMLInputElement>('input[name="inviteCode"]')!, account = homeLoginModal.querySelector<HTMLInputElement>('input[name="email"]')!; name.required = mode === 'register'; inviteCode.required = mode === 'register'; name.parentElement!.firstChild!.textContent = '用户名'; name.placeholder = '用于登录，例如 mochen'; account.type = mode === 'register' ? 'email' : 'text'; account.autocomplete = mode === 'register' ? 'email' : 'username'; account.placeholder = mode === 'register' ? 'name@example.com' : '输入用户名或邮箱'; account.parentElement!.firstChild!.textContent = mode === 'register' ? '邮箱' : '用户名 / 邮箱'; homeLoginModal.querySelector<HTMLElement>('.home-login-submit')!.textContent = mode === 'register' ? '使用邀请码创建账号' : '登录'; homeLoginModal.querySelector<HTMLElement>('.home-login-error')!.textContent = '' }
function renderAuthenticatedUser() { const login = document.querySelector<HTMLButtonElement>('#home-login')!, enter = document.querySelector<HTMLButtonElement>('#home-enter')!, userButton = document.querySelector<HTMLButtonElement>('#workspace-user')!, menu = document.querySelector<HTMLElement>('#workspace-user-menu')!, initial = authUser?.name?.slice(0, 1).toUpperCase() ?? 'V', available = Math.max(0,Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0)); login.disabled = Boolean(authUser); login.textContent = authUser ? `${authUser.name} · 已登录` : '登录'; enter.textContent = authUser ? '返回工作台' : '进入工作台'; userButton.querySelector('span')!.textContent = initial; userButton.querySelector('b')!.textContent = authUser?.name ?? '用户'; menu.querySelector('header i')!.textContent = initial; menu.querySelector('strong')!.textContent = authUser?.name ?? ''; menu.querySelector('header small')!.textContent = [authUser?.username ? `@${authUser.username}` : '', authUser?.email ?? ''].filter(Boolean).join(' · '); menu.querySelector<HTMLElement>('#copy-invite-code b')!.textContent = authUser?.inviteCode ?? '—'; const credits = menu.querySelector<HTMLButtonElement>('#open-lab')!; credits.querySelector('small')!.textContent = `${available} 点`; credits.classList.toggle('enabled', available > 0);if(authUser){void loadNotifications();connectNotificationStream()}else disconnectNotificationStream() }
async function ensureCurrentUserProject() { const response = await fetch('/api/projects'); if (!response.ok) return false; const projects = await response.json() as Array<{ id: string }>; if (!projects.length) return false; if (!projects.some(project => project.id === currentProjectId)) { currentProjectId = projects[0].id; localStorage.setItem('flow-project-id', currentProjectId) } return true }
async function enterWorkspace() { if (!authUser || !await ensureCurrentUserProject()) return; location.hash = '#/canvas'; await Promise.all([loadCanvas(), loadAssets(), loadCustomApiModels()]); applyAppRoute() }
async function loadShowcase() {
  showcaseLoaded = true
  try {
    const response = await fetch('/api/showcase')
    if (!response.ok) throw new Error(String(response.status))
    const assets = await response.json() as Array<{ id: string; name: string; mimeType: string; createdAt: string; author: string; url: string; thumbnailUrl?:string }>
    if (!assets.length) return
    homeGallery.innerHTML = ''
    for (const asset of assets) {
      const video = asset.mimeType.startsWith('video/'), card = document.createElement('article')
      card.className = 'home-gallery-card'; card.tabIndex = 0
      card.innerHTML = `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"><i>${video ? '▶' : '⌕'}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || 'Flow 创作者')}</small></footer>`
      const open = () => openHomePreview(asset)
      card.addEventListener('click', open)
      card.addEventListener('keydown', event => { if (event.key === 'Enter') open() })
      homeGallery.append(card)
    }
  } catch { homeGallery.innerHTML = '<div class="home-gallery-empty"><i>◇</i><b>作品暂时无法加载</b><span>稍后刷新页面再试</span></div>' }
}
function openHomePreview(asset: { name: string; mimeType: string; author: string; url: string }) {
  const image = homePreview.querySelector<HTMLImageElement>('img')!, video = homePreview.querySelector<HTMLVideoElement>('video')!, isVideo = asset.mimeType.startsWith('video/')
  image.hidden = isVideo; video.hidden = !isVideo
  if (isVideo) { video.src = asset.url; void video.play().catch(() => {}) } else { image.src = asset.url; image.alt = asset.name }
  homePreview.querySelector<HTMLElement>('strong')!.textContent = asset.name; homePreview.querySelector<HTMLElement>('footer span')!.textContent = asset.author || 'Flow 创作者'; homePreview.classList.add('open')
}
function closeHomePreview() { const video = homePreview.querySelector<HTMLVideoElement>('video')!; video.pause(); video.removeAttribute('src'); homePreview.querySelector<HTMLImageElement>('img')!.removeAttribute('src'); homePreview.classList.remove('open') }
document.querySelector('#home-login')!.addEventListener('click', () => { if (!authUser) openAuth('login') })
document.querySelector('#home-enter')!.addEventListener('click', requestWorkspace)
document.querySelector('#home-start')!.addEventListener('click', requestWorkspace)
const showcaseSection = document.querySelector<HTMLElement>('.home-showcase')!
const showcaseObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { showcaseSection.classList.add('revealed'); showcaseObserver.disconnect() } }, { threshold: .12 })
showcaseObserver.observe(showcaseSection)
let homeSceneProgress = 0, homeSceneTarget = 0, homeSceneFrame = 0, homeSceneStart = 0, homeSceneStartedAt = 0, homeTouchY = 0, homeWheelDelta = 0, homeWheelResetTimer = 0, homeWheelLockedUntil = 0
function setHomeSceneTarget(value: number) {
  const next = Math.max(0, Math.min(3, Math.round(value)))
  if (next === homeSceneTarget && homeSceneFrame) return
  homeSceneStart = homeSceneProgress
  homeSceneTarget = next
  homeSceneStartedAt = performance.now()
  if (!homeSceneFrame) homeSceneFrame = requestAnimationFrame(animateHomeScene)
}
function animateHomeScene(now: number) {
  const duration = 700
  const elapsed = Math.min(1, Math.max(0, (now - homeSceneStartedAt) / duration))
  const eased = 1 - Math.pow(1 - elapsed, 3)
  homeSceneProgress = homeSceneStart + (homeSceneTarget - homeSceneStart) * eased
  if (elapsed >= 1) homeSceneProgress = homeSceneTarget
  homePage.style.setProperty('--home-progress', homeSceneProgress.toFixed(4))
  homePage.querySelectorAll<HTMLElement>('.home-scene').forEach((element, index) => {
    const distance = index - homeSceneProgress
    element.style.setProperty('--scene-distance', distance.toFixed(4))
    element.style.setProperty('--scene-presence', Math.max(0, 1 - Math.abs(distance)).toFixed(4))
  })
  const scene = Math.max(0, Math.min(3, Math.round(homeSceneProgress)))
  homePage.dataset.scene = String(scene)
  homePage.querySelectorAll<HTMLElement>('[data-home-scene]').forEach(button => button.classList.toggle('active', Number(button.dataset.homeScene) === scene))
  if (elapsed < 1) homeSceneFrame = requestAnimationFrame(animateHomeScene)
  else homeSceneFrame = 0
}
homePage.addEventListener('wheel', event => {
  if (innerWidth <= 800 || homeLoginModal.classList.contains('open') || homePreview.classList.contains('open') || (event.target as HTMLElement).closest('.home-gallery-card')) return
  event.preventDefault()
  if (performance.now() < homeWheelLockedUntil) return
  homeWheelDelta += event.deltaY
  window.clearTimeout(homeWheelResetTimer)
  homeWheelResetTimer = window.setTimeout(() => { homeWheelDelta = 0 }, 180)
  if (Math.abs(homeWheelDelta) < 54) return
  setHomeSceneTarget(Math.round(homeSceneTarget) + Math.sign(homeWheelDelta))
  homeWheelDelta = 0
  homeWheelLockedUntil = performance.now() + 760
}, { passive: false })
homePage.querySelectorAll<HTMLElement>('[data-home-scene]').forEach(button => button.addEventListener('click', () => setHomeSceneTarget(Number(button.dataset.homeScene))))
homePage.querySelectorAll<HTMLAnchorElement>('a[href="#showcase"]').forEach(link => link.addEventListener('click', event => { if (innerWidth <= 800) return; event.preventDefault(); setHomeSceneTarget(3) }))
homePage.addEventListener('touchstart', event => { homeTouchY = event.touches[0]?.clientY ?? 0 }, { passive: true })
homePage.addEventListener('touchend', event => { if (innerWidth <= 800) return; const distance = homeTouchY - (event.changedTouches[0]?.clientY ?? homeTouchY); if (Math.abs(distance) > 45) setHomeSceneTarget(Math.round(homeSceneTarget) + (distance > 0 ? 1 : -1)) }, { passive: true })
setHomeSceneTarget(0)
homeLoginModal.querySelector('.home-login-close')!.addEventListener('click', () => homeLoginModal.classList.remove('open'))
homeLoginModal.addEventListener('click', event => { if (event.target === homeLoginModal) homeLoginModal.classList.remove('open') })
homeLoginModal.querySelectorAll<HTMLElement>('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode as 'login' | 'register')))
homeLoginModal.querySelector('form')!.addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement, submit = form.querySelector<HTMLButtonElement>('.home-login-submit')!, error = form.querySelector<HTMLOutputElement>('.home-login-error')!, data = new FormData(form), completedMode = authMode; submit.disabled = true; error.textContent = ''; try { const response = await fetch(`/api/auth/${completedMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), inviteCode: data.get('inviteCode'), email: data.get('email'), password: data.get('password') }) }); const result = await response.json() as AuthUser & { error?: string }; if (!response.ok) throw new Error(result.error || '登录失败'); authUser = result; authReady = true; lastUserActivity=Date.now();scheduleIdleLogout();renderAuthenticatedUser(); homeLoginModal.classList.remove('open'); form.reset(); if (completedMode === 'register') await enterWorkspace(); else showToast(`欢迎回来，${result.name}`, 'success') } catch (reason) { error.textContent = reason instanceof Error ? reason.message : '登录失败，请重试' } finally { submit.disabled = false } })
homePreview.querySelector(':scope > button')!.addEventListener('click', closeHomePreview)
homePreview.addEventListener('click', event => { if (event.target === homePreview) closeHomePreview() })
const workspaceUserMenu = document.querySelector<HTMLElement>('#workspace-user-menu')!
let visibleUserApiToken=''
async function loadUserApiTokenState(){if(!authUser)return;const code=workspaceUserMenu.querySelector<HTMLElement>('[data-user-token]')!,copy=workspaceUserMenu.querySelector<HTMLButtonElement>('[data-token-copy]')!,refresh=workspaceUserMenu.querySelector<HTMLButtonElement>('[data-token-refresh]')!;try{const response=await fetch('/api/users/me/api-token'),result=await response.json() as {exists?:boolean;hint?:string};if(!response.ok)throw new Error();if(!visibleUserApiToken)code.textContent=result.exists?result.hint||'已生成':'尚未生成';copy.disabled=!visibleUserApiToken;refresh.textContent=result.exists?'刷新':'生成'}catch{code.textContent='读取失败'}}
const renameUserButton = document.createElement('button'); renameUserButton.id = 'rename-user'; renameUserButton.type = 'button'; renameUserButton.title = '修改昵称'; renameUserButton.setAttribute('aria-label', '修改昵称'); renameUserButton.textContent = '✎'; workspaceUserMenu.querySelector('header')!.append(renameUserButton)
async function editUserNickname() { if (!authUser) return; const header = workspaceUserMenu.querySelector('header')!, name = header.querySelector<HTMLElement>('strong')!, input = document.createElement('input'); input.className = 'user-name-input'; input.value = authUser.name; input.maxLength = 40; name.hidden = true; renameUserButton.hidden = true; name.after(input); input.focus(); input.select(); let finished = false; const finish = async (save: boolean) => { if (finished) return; finished = true; const nextName = input.value.trim(); input.remove(); name.hidden = false; renameUserButton.hidden = false; if (!save || nextName === authUser!.name) return; if (nextName.length < 2) { showToast('昵称至少需要 2 个字符', 'error'); return } const response = await fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nextName }) }); const result = await response.json().catch(() => ({})) as AuthUser & { error?: string }; if (!response.ok) { showToast(result.error || '昵称修改失败', 'error'); return } authUser = { ...authUser!, name: result.name }; renderAuthenticatedUser(); showToast('昵称已更新', 'success') }; input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void finish(true) } else if (event.key === 'Escape') { event.preventDefault(); void finish(false) } }); input.addEventListener('blur', () => void finish(true)) }
renameUserButton.addEventListener('click', event => { event.stopPropagation(); void editUserNickname() })
document.querySelector('#workspace-user')!.addEventListener('click', event => { event.stopPropagation();const opening=!workspaceUserMenu.classList.contains('open');closeTopbarMenus(opening?'user':undefined);if(opening){workspaceUserMenu.classList.add('open');void loadUserApiTokenState()} })
async function logoutToHome(message?:string){await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});authUser=null;visibleUserApiToken='';nodes.splice(0);links.splice(0);selectedId=0;workspaceUserMenu.classList.remove('open');renderAuthenticatedUser();location.hash='#/';applyAppRoute();if(message)showToast(message,'warning')}
document.querySelector('#workspace-logout')!.addEventListener('click', () => void logoutToHome())
document.querySelector('#copy-invite-code')!.addEventListener('click', async () => { if (!authUser?.inviteCode) return; await navigator.clipboard.writeText(authUser.inviteCode); const label = document.querySelector<HTMLElement>('#copy-invite-code span')!; label.textContent = '已复制'; window.setTimeout(() => { label.textContent = '复制' }, 1400) })
workspaceUserMenu.querySelector<HTMLButtonElement>('[data-token-refresh]')!.addEventListener('click',async event=>{event.stopPropagation();const button=event.currentTarget as HTMLButtonElement,code=workspaceUserMenu.querySelector<HTMLElement>('[data-user-token]')!,copy=workspaceUserMenu.querySelector<HTMLButtonElement>('[data-token-copy]')!;button.disabled=true;button.textContent='生成中…';try{const response=await fetch('/api/users/me/api-token',{method:'POST'}),result=await response.json() as {token?:string;error?:string};if(!response.ok||!result.token)throw new Error(result.error||'Token 生成失败');visibleUserApiToken=result.token;code.textContent=result.token;code.title=result.token;copy.disabled=false;button.textContent='刷新';await navigator.clipboard.writeText(result.token).catch(()=>{});showToast('新 Token 已生成并复制，请妥善保存','success')}catch(reason){showToast(reason instanceof Error?reason.message:'Token 生成失败','error');button.textContent='重试'}finally{button.disabled=false}})
workspaceUserMenu.querySelector<HTMLButtonElement>('[data-token-copy]')!.addEventListener('click',async event=>{event.stopPropagation();if(!visibleUserApiToken)return;await navigator.clipboard.writeText(visibleUserApiToken);const button=event.currentTarget as HTMLButtonElement;button.textContent='已复制';window.setTimeout(()=>button.textContent='复制',1200)})
document.addEventListener('pointerdown', event => { if (!(event.target as HTMLElement | null)?.closest('#workspace-user,#workspace-user-menu')) workspaceUserMenu.classList.remove('open') })
const feedbackModal=document.querySelector<HTMLElement>('#feedback-modal')!,feedbackForm=feedbackModal.querySelector<HTMLFormElement>('#feedback-form')!
const notificationModal=document.querySelector<HTMLElement>('#notification-modal')!,notificationList=notificationModal.querySelector<HTMLElement>('#notification-list')!,notificationCount=document.querySelector<HTMLElement>('[data-notification-count]')!
function notificationTime(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)}
function renderNotifications(){const unread=appNotifications.filter(item=>!item.isRead).length;notificationCount.textContent=String(unread);notificationCount.parentElement!.classList.toggle('has-unread',unread>0);notificationCount.parentElement!.title=unread?`${unread} 条未读通知`:'暂无未读通知';notificationList.innerHTML=appNotifications.length?appNotifications.map(item=>`<article class="notification-item${item.isRead?' read':' unread'}" data-notification-id="${escapeHtml(item.id)}"><i aria-hidden="true"></i><div><header><span>${item.type==='fix'?'问题修复':'产品更新'}</span><time>${escapeHtml(notificationTime(item.createdAt))}</time></header><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p></div></article>`).join(''):'<div class="notification-empty"><i>◇</i><b>暂时没有新通知</b><span>产品进展会在这里与你同步</span></div>';notificationList.querySelectorAll<HTMLElement>('[data-notification-id]').forEach(item=>item.addEventListener('click',async()=>{const id=item.dataset.notificationId!,target=appNotifications.find(entry=>entry.id===id);if(!target||target.isRead)return;target.isRead=true;renderNotifications();const response=await fetch(`/api/notifications/${encodeURIComponent(id)}/read`,{method:'POST'});if(!response.ok){target.isRead=false;renderNotifications();showToast('通知状态同步失败，请稍后重试','error')}}))}
async function claimDailyNotificationPopup(){if(!authUser||autoPopupCheckedUserId===authUser.id)return;autoPopupCheckedUserId=authUser.id;try{const response=await fetch('/api/notifications/claim-popup',{method:'POST'}),result=await response.json() as {show?:boolean};if(response.ok&&result.show)notificationModal.classList.add('open')}catch{/* 未读角标仍可正常使用 */}}
async function loadNotifications(){if(!authUser){appNotifications=[];autoPopupCheckedUserId='';renderNotifications();return}try{const response=await fetch('/api/notifications');if(!response.ok)throw new Error(String(response.status));appNotifications=await response.json() as AppNotification[];renderNotifications();void claimDailyNotificationPopup()}catch{notificationCount.textContent='!';if(notificationModal.classList.contains('open'))notificationList.innerHTML='<div class="notification-empty"><i>!</i><b>通知加载失败</b><span>请稍后重新打开</span></div>'}}
function showServiceStatusNotice(mode:'offline'|'online'){serviceKnownOffline=mode==='offline';showCanvasGuide(mode==='offline'?{key:'service-status',title:'服务器暂时离线',detail:'正在后台尝试重新连接，恢复后会自动同步。',tone:'offline',priority:100}:{key:'service-status',title:'已重新连接',detail:'通知和创作状态已恢复同步。',tone:'online',priority:100,duration:2600})}
function showCanvasModeNotice(title:string,detail:string){showCanvasGuide({key:'canvas-mode',title,detail,tone:'online',priority:20,duration:2100})}
function stopNotificationFallback(){window.clearInterval(notificationFallbackTimer);notificationFallbackTimer=0}
function startNotificationFallback(){if(notificationFallbackTimer)return;notificationFallbackTimer=window.setInterval(()=>{if(!authUser)return;const stream=notificationStream;if(stream)void verifyServiceReachability(stream);void loadNotifications();void checkForAppUpdate()},15000)}
async function verifyServiceReachability(stream:EventSource){if(notificationStream!==stream||!authUser)return;try{const response=await fetch(`/api/health?guide-check=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(4000)});if(response.ok){serviceReachabilityFailures=0;if(serviceKnownOffline)showServiceStatusNotice('online');startNotificationFallback();void checkForAppUpdate();return}}catch{/* 连续失败后再显示离线 */}if(notificationStream!==stream)return;serviceReachabilityFailures++;if(serviceReachabilityFailures>=2&&!serviceKnownOffline)showServiceStatusNotice('offline')}
function disconnectNotificationStream(){window.clearTimeout(notificationOfflineTimer);stopNotificationFallback();serviceReachabilityFailures=0;notificationStream?.close();notificationStream=null;notificationStreamUserId='';notificationServerVersion='';hideCanvasGuide('service-status')}
function connectNotificationStream(){if(!authUser)return disconnectNotificationStream();if(notificationStream&&notificationStreamUserId===authUser.id)return;disconnectNotificationStream();notificationStreamUserId=authUser.id;let connected=false,wasOffline=false;const stream=new EventSource('/api/notifications/stream');notificationStream=stream;stream.onopen=()=>{if(notificationStream!==stream)return;window.clearTimeout(notificationOfflineTimer);stopNotificationFallback();serviceReachabilityFailures=0;if(wasOffline||canvasGuideKey==='service-status')showServiceStatusNotice('online');connected=true;wasOffline=false};stream.onerror=()=>{if(!authUser||notificationStream!==stream)return;connected=false;window.clearTimeout(notificationOfflineTimer);startNotificationFallback();notificationOfflineTimer=window.setTimeout(()=>{if(notificationStream===stream&&!connected&&stream.readyState!==EventSource.OPEN){wasOffline=true;void verifyServiceReachability(stream)}},3500)};stream.addEventListener('notifications',event=>{if(notificationStream!==stream)return;void loadNotifications();try{const payload=JSON.parse((event as MessageEvent<string>).data) as {serverVersion?:string};if(notificationServerVersion&&payload.serverVersion&&payload.serverVersion!==notificationServerVersion)void checkForAppUpdate();if(payload.serverVersion)notificationServerVersion=payload.serverVersion}catch{/* 下一次事件继续同步 */}})}
document.querySelector('#open-notifications')!.addEventListener('click',()=>{const opening=!notificationModal.classList.contains('open');closeTopbarMenus(opening?'notifications':undefined);if(opening){notificationModal.classList.add('open');void loadNotifications()}})
notificationModal.querySelectorAll('[data-notification-close]').forEach(button=>button.addEventListener('click',()=>notificationModal.classList.remove('open')))
notificationModal.addEventListener('pointerdown',event=>{if(event.target===notificationModal)notificationModal.classList.remove('open')})
notificationModal.querySelector<HTMLElement>('[data-notification-read-all]')!.addEventListener('click',async()=>{if(!appNotifications.some(item=>!item.isRead))return;const previous=appNotifications.map(item=>item.isRead);appNotifications.forEach(item=>item.isRead=true);renderNotifications();const response=await fetch('/api/notifications/read-all',{method:'POST'});if(!response.ok){appNotifications.forEach((item,index)=>item.isRead=previous[index]);renderNotifications();showToast('全部已读同步失败，请稍后重试','error')}})
document.querySelector('#open-feedback')!.addEventListener('click',()=>{workspaceUserMenu.classList.remove('open');feedbackModal.classList.add('open');feedbackForm.querySelector<HTMLInputElement>('input[name="title"]')!.focus()})
feedbackModal.querySelectorAll('[data-feedback-close]').forEach(button=>button.addEventListener('click',()=>feedbackModal.classList.remove('open')))
feedbackModal.addEventListener('pointerdown',event=>{if(event.target===feedbackModal)feedbackModal.classList.remove('open')})
feedbackForm.addEventListener('submit',async event=>{event.preventDefault();const submit=feedbackForm.querySelector<HTMLButtonElement>('button[type="submit"]')!,output=feedbackForm.querySelector<HTMLOutputElement>('output')!,data=Object.fromEntries(new FormData(feedbackForm));submit.disabled=true;output.textContent='正在提交…';try{const response=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,projectId:currentProjectId||undefined,pageUrl:location.href,userAgent:navigator.userAgent})}),result=await response.json().catch(()=>({})) as {id?:string;error?:string};if(!response.ok)throw new Error(result.error||'提交失败');feedbackForm.reset();output.textContent='感谢反馈，我们已经收到。';showToast('反馈已提交，感谢你的帮助','success');window.setTimeout(()=>{feedbackModal.classList.remove('open');output.textContent=''},1200)}catch(reason){output.textContent=reason instanceof Error?reason.message:'提交失败，请稍后重试'}finally{submit.disabled=false}})
const labModal = document.querySelector<HTMLElement>('#lab-modal')!
document.querySelector('#open-lab')!.addEventListener('click', () => { workspaceUserMenu.classList.remove('open'); const available=Math.max(0,Number(authUser?.credits??0)-Number(authUser?.reservedCredits??0)); labModal.querySelector<HTMLElement>('[data-credit-value]')!.textContent=String(available); labModal.querySelector<HTMLElement>('[data-credit-reserved]')!.textContent=Number(authUser?.reservedCredits??0)>0?`${authUser!.reservedCredits} 点正在生成任务中冻结`:''; labModal.querySelector<HTMLFormElement>('#credit-admin-form')!.hidden=!authUser?.isAdmin; labModal.classList.add('open') })
labModal.querySelectorAll<HTMLElement>('[data-lab-close]').forEach(button => button.addEventListener('click', () => labModal.classList.remove('open')))
labModal.addEventListener('pointerdown', event => { if (event.target === labModal) labModal.classList.remove('open') })
labModal.querySelector<HTMLFormElement>('#credit-redeem-form')!.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement,submit=form.querySelector<HTMLButtonElement>('button')!,output=form.querySelector<HTMLOutputElement>('output')!,code=new FormData(form).get('code');submit.disabled=true;output.textContent='正在兑换…';try{const response=await fetch('/api/users/me/credits/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})}),result=await response.json().catch(()=>({})) as {added?:number;credits?:number;reservedCredits?:number;error?:string};if(!response.ok)throw new Error(result.error||'兑换失败');authUser={...authUser!,credits:result.credits,reservedCredits:result.reservedCredits};renderAuthenticatedUser();refreshNodeModelMenus();labModal.querySelector<HTMLElement>('[data-credit-value]')!.textContent=String(Math.max(0,Number(result.credits??0)-Number(result.reservedCredits??0)));form.reset();output.textContent=`兑换成功，已到账 ${result.added} 点`;showToast(`已到账 ${result.added} 创作点数`,'success')}catch(reason){output.textContent=reason instanceof Error?reason.message:'兑换失败，请重试'}finally{submit.disabled=false}})
const creditAdminForm=labModal.querySelector<HTMLFormElement>('#credit-admin-form')!,creditCodesOutput=creditAdminForm.querySelector<HTMLTextAreaElement>('textarea')!
creditAdminForm.addEventListener('submit',async event=>{event.preventDefault();const submit=creditAdminForm.querySelector<HTMLButtonElement>('button[type="submit"]')!,output=creditAdminForm.querySelector<HTMLOutputElement>('output')!,data=Object.fromEntries(new FormData(creditAdminForm));submit.disabled=true;output.textContent='正在生成…';try{const response=await fetch('/api/admin/recharge-codes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),result=await response.json().catch(()=>({})) as {codes?:string[];error?:string};if(!response.ok)throw new Error(result.error||'生成失败');creditCodesOutput.value=(result.codes??[]).join('\n');output.textContent=`已生成 ${result.codes?.length??0} 个充值码`}catch(reason){output.textContent=reason instanceof Error?reason.message:'生成失败'}finally{submit.disabled=false}})
creditAdminForm.querySelector('[data-copy-codes]')!.addEventListener('click',async()=>{if(!creditCodesOutput.value)return;await navigator.clipboard.writeText(creditCodesOutput.value);showToast('充值码已复制','success')})
const customApiModal = document.querySelector<HTMLElement>('#custom-api-modal')!, customApiForm = document.querySelector<HTMLFormElement>('#custom-api-form')!, customApiList = document.querySelector<HTMLElement>('#custom-api-list')!
function refreshNodeModelMenus() { nodeLayer.querySelectorAll('.flow-node').forEach(element => element.remove()); draw() }
async function loadCustomApiModels() { const response = await fetch('/api/user-api-models'); if (response.ok) { customApiModels = await response.json() as CustomApiModel[]; renderCustomApiModels(); refreshNodeModelMenus() } }
function renderCustomApiModels() { customApiList.innerHTML = customApiModels.length ? customApiModels.map(item => `<article class="custom-api-entry" data-custom-id="${item.id}"><b>${escapeHtml(item.name)}</b><small>${item.kind === 'image' ? '图像' : '视频'} · ${escapeHtml(item.model)} · ${escapeHtml(item.baseUrl)}</small><button type="button">删除</button></article>`).join('') : '<article class="custom-api-entry"><b>还没有自定义模型</b><small>添加后会出现在对应节点的模型列表中</small></article>'; customApiList.querySelectorAll<HTMLButtonElement>('[data-custom-id] button').forEach(button => button.addEventListener('click', async () => { const id = button.closest<HTMLElement>('[data-custom-id]')!.dataset.customId!; if ((await fetch(`/api/user-api-models/${id}`, { method:'DELETE' })).ok) { customApiModels = customApiModels.filter(item => item.id !== id); renderCustomApiModels(); refreshNodeModelMenus() } })) }
document.querySelector<HTMLButtonElement>('#open-custom-api')!.addEventListener('click', event => { const button = event.currentTarget as HTMLButtonElement; if (button.disabled) return; workspaceUserMenu.classList.remove('open'); customApiModal.classList.add('open'); void loadCustomApiModels() })
customApiModal.querySelector('[data-custom-close]')!.addEventListener('click', () => customApiModal.classList.remove('open'))
customApiModal.addEventListener('pointerdown', event => { if (event.target === customApiModal) customApiModal.classList.remove('open') })
document.querySelector('#custom-api-test')!.addEventListener('click', async () => { const data = new FormData(customApiForm), output = customApiForm.querySelector<HTMLOutputElement>('output')!; output.textContent = '正在测试连接…'; const response = await fetch('/api/user-api-models/test', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ baseUrl:data.get('baseUrl'), apiKey:data.get('apiKey') }) }); const result = await response.json().catch(() => ({})) as { error?:string }; output.textContent = response.ok ? '连接成功' : `连接失败：${result.error || '未知错误'}` })
customApiForm.addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(customApiForm)), output = customApiForm.querySelector<HTMLOutputElement>('output')!; const response = await fetch('/api/user-api-models', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data) }); const result = await response.json().catch(() => ({})) as CustomApiModel & { error?:string }; if (!response.ok) { output.textContent = result.error || '添加失败'; return } customApiModels.push(result); customApiForm.reset(); output.textContent = '已添加，可在模型列表中选择'; renderCustomApiModels(); refreshNodeModelMenus() })
window.addEventListener('hashchange', applyAppRoute)
applyAppRoute()

const screen = (p: Point): Point => ({ x: innerWidth / 2 + camera.x + p.x * camera.zoom, y: innerHeight / 2 + camera.y + p.y * camera.zoom })
const world = (p: Point): Point => ({ x: (p.x - innerWidth / 2 - camera.x) / camera.zoom, y: (p.y - innerHeight / 2 - camera.y) / camera.zoom })

function roundedRect(x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }

function drawGrid() {
  if (backgroundMode === 'blank') return
  const gap = 42 * camera.zoom
  if (gap < 10) return
  const origin = screen({ x: 0, y: 0 })
  if (backgroundMode === 'lines') { ctx.beginPath(); for (let x = origin.x % gap; x < innerWidth; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight) } for (let y = origin.y % gap; y < innerHeight; y += gap) { ctx.moveTo(0, y); ctx.lineTo(innerWidth, y) } ctx.strokeStyle = colorTheme === 'dark' ? 'rgba(143,197,197,.105)' : 'rgba(74,111,101,.13)'; ctx.lineWidth = 1; ctx.stroke(); return }
  ctx.fillStyle = colorTheme === 'dark' ? 'rgba(143,197,197,.24)' : 'rgba(74,111,101,.27)'
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

function nodeIsActivelyGenerating(node: FlowNode | undefined) { return node?.status === 'queued' || node?.status === 'running' }
function canvasHasActiveGeneration() { return nodes.some(node => nodeIsActivelyGenerating(node)) }
function nodeFeedsActiveGeneration(nodeId: number) {
  const visited = new Set<number>()
  const pending = [nodeId]
  while (pending.length) {
    const currentId = pending.pop()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    if (currentId !== nodeId && nodeIsActivelyGenerating(nodes.find(node => node.id === currentId))) return true
    links.filter(link => link.from === currentId).forEach(link => pending.push(link.to))
  }
  return false
}
function nodeIsGenerationProtected(node: FlowNode) { return nodeIsActivelyGenerating(node) || nodeFeedsActiveGeneration(node.id) }
function linkIsGenerating(link: FlowLink) {
  const target = nodes.find(node => node.id === link.to)
  return nodeIsActivelyGenerating(target) || nodeFeedsActiveGeneration(link.to)
}
function orderedImageInputs(targetId: number) {
  return links
    .filter(link => link.to === targetId)
    .map(link => ({ link, node: nodes.find(node => node.id === link.from) }))
    .filter((input): input is { link: FlowLink; node: FlowNode } => Boolean(input.node?.kind === 'image' && input.node.mediaUrl))
    .sort((left, right) => left.node.y - right.node.y || left.node.x - right.node.x || left.node.id - right.node.id)
}
function imageInputOrder(link: FlowLink) {
  const index = orderedImageInputs(link.to).findIndex(input => input.link === link)
  return index < 0 ? undefined : index + 1
}
function orderedTargetLinks(targetId: number) {
  return links
    .filter(link => link.to === targetId)
    .map((link, originalIndex) => ({ link, originalIndex, source: nodes.find(node => node.id === link.from) }))
    .sort((left, right) => {
      const leftOrder = left.link.inputOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.link.inputOrder ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
        || (left.source?.y ?? 0) - (right.source?.y ?? 0)
        || (left.source?.x ?? 0) - (right.source?.x ?? 0)
        || left.originalIndex - right.originalIndex
    })
    .map(item => item.link)
}
function linkPathGeometry(link: FlowLink) {
  const from = nodes.find(node => node.id === link.from), to = nodes.find(node => node.id === link.to)
  if (!from || !to) return null
  const a = screen(portWorld(from, link.fromSide)), b = screen(portWorld(to, link.toSide))
  const curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .35)
  const ca = controlPoint(a, link.fromSide, curve), cb = controlPoint(b, link.toSide, curve)
  const siblings = orderedTargetLinks(link.to)
  const rank = siblings.indexOf(link)
  if (rank >= 0 && siblings.length > 1) {
    // Connections that share a target can otherwise overlap perfectly. Fan their
    // curves out while keeping the real port position unchanged.
    const spread = (rank - (siblings.length - 1) / 2) * Math.min(34, 18 + siblings.length * 4) * camera.zoom
    ca.y += spread * .72
    cb.y += spread
  }
  return { a, b, ca, cb }
}
function drawLink(link: FlowLink, index: number) {
  const geometry = linkPathGeometry(link)
  if (!geometry) return
  const { a, b, ca, cb } = geometry
  ctx.beginPath(); ctx.moveTo(a.x, a.y)
  ctx.bezierCurveTo(ca.x, ca.y, cb.x, cb.y, b.x, b.y)
  const generating = linkIsGenerating(link), hovered = index === hoveredLinkIndex || index === touchSelectedLinkIndex
  ctx.save()
  if (generating) { ctx.setLineDash([10 * camera.zoom, 8 * camera.zoom]); ctx.lineDashOffset = -(performance.now() / 28) % (18 * camera.zoom); ctx.strokeStyle = colorTheme === 'dark' ? 'rgba(111,199,195,.72)' : 'rgba(72,137,122,.64)'; ctx.lineWidth = 2.25 * camera.zoom }
  else if (hovered) { ctx.strokeStyle = colorTheme === 'dark' ? 'rgba(178,222,218,.72)' : 'rgba(42,76,67,.76)'; ctx.lineWidth = 3 * camera.zoom; ctx.shadowColor = colorTheme === 'dark' ? 'rgba(88,190,186,.2)' : 'rgba(38,76,66,.13)'; ctx.shadowBlur = 5 * camera.zoom }
  else { ctx.strokeStyle = 'rgba(183,190,201,.5)'; ctx.lineWidth = 2 * camera.zoom }
  ctx.stroke(); ctx.restore()
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
function hitPort(sx: number, sy: number, radius = 12, excludeNodeId?: number) { const sides: PortSide[] = ['top', 'right', 'bottom', 'left']; let closest: { node: FlowNode; side: PortSide; distance: number } | undefined; for (const node of [...nodes].reverse()) { if (node.id === excludeNodeId || (node.kind === 'video' && node.role === 'result')) continue; for (const side of sides) { const p = screen(portWorld(node, side)), distance = Math.hypot(sx - p.x, sy - p.y); if (distance <= radius && (!closest || distance < closest.distance)) closest = { node, side, distance } } } return closest && { node: closest.node, side: closest.side } }
function directedLink(firstId:number,firstSide:PortSide,secondId:number,secondSide:PortSide):FlowLink|null{if(firstId===secondId||firstSide!=='right'||secondSide!=='left')return null;return{from:firstId,to:secondId,fromSide:'right',toSide:'left'}}
function updateConnectionPointer(sx: number, sy: number) { if (!connecting) return; const candidate = hitPort(sx, sy, connectionSnapRadius, connecting.nodeId),target=candidate&&candidate.side==='left'?candidate:null; connectionSnap = target ? { nodeId: target.node.id, side: target.side } : null; connecting.pointer = target ? screen(portWorld(target.node, target.side)) : { x: sx, y: sy } }
function hitLink(sx: number, sy: number, tolerance = 9) {
  for (let index = links.length - 1; index >= 0; index--) {
    const geometry = linkPathGeometry(links[index])
    if (!geometry) continue
    const { a, b, ca, cb } = geometry
    let previous = a
    for (let step = 1; step <= 32; step++) { const t = step / 32, inverse = 1 - t, point = { x: inverse ** 3 * a.x + 3 * inverse ** 2 * t * ca.x + 3 * inverse * t ** 2 * cb.x + t ** 3 * b.x, y: inverse ** 3 * a.y + 3 * inverse ** 2 * t * ca.y + 3 * inverse * t ** 2 * cb.y + t ** 3 * b.y }; const length = Math.hypot(point.x - previous.x, point.y - previous.y) || 1, projection = Math.max(0, Math.min(1, ((sx - previous.x) * (point.x - previous.x) + (sy - previous.y) * (point.y - previous.y)) / (length * length))), distance = Math.hypot(sx - (previous.x + projection * (point.x - previous.x)), sy - (previous.y + projection * (point.y - previous.y))); if (distance <= tolerance) return index; previous = point }
  }
  return -1
}
function drawPendingLink() { if (!connecting) return; const node = nodes.find(item => item.id === connecting!.nodeId); if (!node) return; const a = screen(portWorld(node, connecting.side)), b = connecting.pointer; ctx.save();ctx.beginPath(); ctx.moveTo(a.x, a.y); const distance = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .3), control = controlPoint(a, connecting.side, distance); ctx.quadraticCurveTo(control.x, control.y, b.x, b.y); ctx.strokeStyle = colorTheme==='dark'?'rgba(132,226,235,.96)':'rgba(24,112,132,.96)';ctx.shadowColor=colorTheme==='dark'?'rgba(77,205,218,.34)':'rgba(20,105,127,.2)';ctx.shadowBlur=6; ctx.lineWidth = 2.4; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);ctx.restore(); if (connectionSnap) { ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, Math.PI * 2); ctx.fillStyle = colorTheme==='dark'?'rgba(111,220,229,.2)':'rgba(20,112,132,.18)'; ctx.fill(); ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fillStyle = colorTheme==='dark'?'#8de3ea':'#176f83'; ctx.fill() } }
function paint() { drawFrame = null; ctx.fillStyle = colorTheme === 'dark' ? '#0b1113' : '#eef3ef'; ctx.fillRect(0, 0, innerWidth, innerHeight); drawGrid(); links.forEach(drawLink); drawPendingLink(); syncDomNodes(); updateTaskMonitor(); updateCancelPendingButton(); zoomSlider.value = String(Math.round(camera.zoom * 100)); zoomSlider.title = `${Math.round(camera.zoom * 100)}%`; zoomPercent.value = `${Math.round(camera.zoom * 100)}%`; nodeCount.textContent = String(nodes.length); if (links.some(linkIsGenerating)) draw() }
function draw() { if (drawFrame === null) drawFrame = requestAnimationFrame(paint) }
function resize() { const ratio = Math.min(devicePixelRatio || 1, innerWidth <= 780 ? 1.5 : 2); canvas.width = innerWidth * ratio; canvas.height = innerHeight * ratio; canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw() }
function setZoom(next: number, anchor = { x: innerWidth / 2, y: innerHeight / 2 }) { const old = camera.zoom; next = Math.min(2.5, Math.max(.3, next)); const cx = innerWidth / 2 + camera.x, cy = innerHeight / 2 + camera.y; camera.x += (anchor.x - cx) * (1 - next / old); camera.y += (anchor.y - cy) * (1 - next / old); camera.zoom = next; draw() }
function currentPinch() { const points=[...canvasTouches.values()].slice(0,2);if(points.length<2)return null;const [a,b]=points;return{distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}} }
function cancelSingleTouchActions() { pointer.down=false;pointer.draggingNode=null;canvas.classList.remove('dragging');connecting=null;connectionSnap=null;if(domDrag){domDrag.element.classList.remove('dragging');domDrag=null}if(domDragFrame!==null)cancelAnimationFrame(domDragFrame);domDragFrame=null }
document.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||!(event.target as HTMLElement|null)?.closest('#canvas,.flow-node'))return;canvasTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});if(canvasTouches.size<2)return;event.preventDefault();event.stopImmediatePropagation();cancelSingleTouchActions();pinchGesture=currentPinch();zoomTarget=camera.zoom},{capture:true,passive:false})
document.addEventListener('pointermove',event=>{if(!canvasTouches.has(event.pointerId))return;canvasTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});if(!pinchGesture||canvasTouches.size<2)return;event.preventDefault();event.stopImmediatePropagation();const next=currentPinch();if(!next)return;const previous=pinchGesture,scale=next.distance/previous.distance;setZoom(camera.zoom*scale,next.center);camera.x+=next.center.x-previous.center.x;camera.y+=next.center.y-previous.center.y;zoomTarget=camera.zoom;pinchGesture=next;draw()},{capture:true,passive:false})
function endCanvasTouch(event:PointerEvent){if(!canvasTouches.has(event.pointerId))return;const wasPinching=Boolean(pinchGesture);canvasTouches.delete(event.pointerId);if(!wasPinching)return;event.preventDefault();event.stopImmediatePropagation();pinchGesture=canvasTouches.size>=2?currentPinch():null;cancelSingleTouchActions();draw()}
document.addEventListener('pointerup',endCanvasTouch,{capture:true,passive:false})
document.addEventListener('pointercancel',endCanvasTouch,{capture:true,passive:false})
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
function addNode(kind: NodeKind = 'image', position?: Point, deferRender=false) { const center = position ?? world({ x: innerWidth / 2, y: innerHeight / 2 }); const titles = { prompt: '标签', image: '文生图 · 新任务', video: '视频生成 · 新任务', note: '创作便签' },width=kind==='video'?290:265,height=kind==='video'?225:kind === 'note' ? 135 : 175; nodes.push({ id: nextId, publicId: makePublicId(kind), kind, x: center.x - width/2, y: center.y - height/2, width, height, title: titles[kind], body: kind === 'image' || kind === 'video' ? '' : kind === 'prompt' ? '记录标签、分组标题或画布备注' : '等待配置模型与生成参数', accent: kind === 'video' ? '#ffb774' : kind === 'prompt' ? '#e7ff70' : kind === 'note' ? '#b6efa2' : '#8ee7ff', model: kind === 'video' ? generationCapabilities.video?.defaultModel ?? 'agnes-video-v2.0' : generationCapabilities.image?.defaultModel ?? 'gpt-image-2', videoSettings: kind === 'video' ? { seconds: String(generationCapabilities.video?.seconds.default ?? 5), resolution: generationCapabilities.video?.resolutions[1] ?? '720p', aspectRatio: generationCapabilities.video?.aspectRatios.at(-1) ?? '16:9' } : undefined }); selectedId = nextId++; if(!deferRender){updateEditor();scheduleSave();draw()} }
function addMediaNode(url: string, title: string, position = contextPosition, kind: 'image' | 'video' = 'image') { nodes.push({ id: nextId, publicId: makePublicId(kind), kind, role: kind === 'video' ? 'result' : undefined, x: position.x - 145, y: position.y - 120, width: 290, height: 240, title, body: '', accent: kind === 'video' ? '#ffb774' : '#8ee7ff', mediaUrl: url, model: kind === 'video' ? generationCapabilities.video?.defaultModel ?? 'agnes-video-v2.0' : generationCapabilities.image?.defaultModel ?? 'gpt-image-2', videoSettings: kind === 'video' ? { seconds: '5', resolution: '720p', aspectRatio: '16:9' } : undefined }); selectedId = nextId++; updateEditor(); scheduleSave(); draw() }

function syncDomNodes() {
  nodeViewport.style.transform = `translate(${innerWidth / 2 + camera.x}px, ${innerHeight / 2 + camera.y}px) scale(${camera.zoom})`
  const live = new Set(nodes.map(node => String(node.id)))
  nodeLayer.querySelectorAll<HTMLElement>('.flow-node').forEach(element => { if (!live.has(element.dataset.id!)) element.remove() })
  for (const node of nodes) {
    let element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`)
    if (!element) { element = createDomNode(node); nodeLayer.append(element) }
    const workflowWaiting = Boolean(node.agentAuto && node.status === 'waiting')
    const locked = (nodeIsActivelyGenerating(node) || workflowWaiting) && !(node.kind === 'video' && node.role !== 'result')
    if(!Number.isFinite(node.width)||node.width<1)node.width=280;if(!Number.isFinite(node.height)||node.height<1)node.height=220
    if(node.kind==='video'&&node.role!=='result'){node.width=Math.max(290,node.width);node.height=Math.max(225,node.height)}
    element.className = `flow-node kind-${node.kind}${node.role === 'result' ? ' node-result' : ' node-generator'}${node.id === selectedId ? ' selected' : ''}${batchSelectedIds.has(node.id)?' batch-selected':''}${promptAgentSelecting&&promptAgentContextSelection.has(node.id)?' agent-reference':''}${locked ? ' generating' : ''}${workflowWaiting ? ' workflow-waiting' : ''}`
    element.querySelectorAll<HTMLElement>('.node-port').forEach(port => { port.hidden = node.kind === 'video' && node.role === 'result' })
    element.style.transform = `translate(${node.x}px, ${node.y}px)`; element.style.width = `${node.width}px`; element.style.height = `${node.height}px`; element.style.setProperty('--accent', node.accent); element.style.setProperty('--font-scale', String(node.fontScale ?? 1))
    const copy = element.querySelector<HTMLElement>('.node-copy')!; if (editingTextNodeId !== node.id) copy.textContent = node.body || defaultNodeCopy(node.kind)
    const labelHeading=element.querySelector<HTMLElement>('.node-label-heading')!;labelHeading.hidden=node.kind!=='prompt';if(node.kind==='prompt'&&document.activeElement!==labelHeading)labelHeading.textContent=node.title||'未命名标签'
    element.querySelector<HTMLElement>('.node-kind')!.textContent = node.kind === 'prompt' ? 'LABEL' : node.kind === 'note' ? 'NOTE' : node.kind === 'video' ? 'VIDEO' : 'IMAGE'
    if (node.kind === 'video') {
      const emptyState = element.querySelector<HTMLElement>('.image-empty-state')!
      if (node.role === 'result') emptyState.innerHTML = '<span>▶</span><b>正在生成视频</b><small>完成后可在这里双击播放</small>'
      else {
        const referenceLinks=links.filter(link=>link.to===node.id).map(link=>({link,source:nodes.find(item=>item.id===link.from)})).filter((item):item is {link:FlowLink;source:FlowNode}=>item.source?.kind==='image').sort((left,right)=>(left.link.inputOrder??Number.MAX_SAFE_INTEGER)-(right.link.inputOrder??Number.MAX_SAFE_INTEGER)||left.source.y-right.source.y||left.source.x-right.source.x||left.source.id-right.source.id)
        const totalReferences=referenceLinks.length,readyReferences=referenceLinks.filter(item=>Boolean(item.source.mediaUrl)).length
        const mode = totalReferences > 1 ? '多图生视频' : totalReferences === 1 ? '图生视频' : '文生视频'
        const settings = node.videoSettings ?? {}
        const frames = referenceLinks.map(({source},index)=>source.mediaUrl?`<i class="has-image" title="参考图 ${index+1} · 已就绪"><canvas class="reference-image" width="180" height="120" data-reference-url="${escapeHtml(source.mediaUrl)}"></canvas><b>${index+1}</b></i>`:`<i class="is-waiting" title="参考图 ${index+1} · 等待生成"><span>${index+1}</span><small>等待</small></i>`).join('')
        const placeholders = totalReferences ? '' : '<i><span>1</span></i><i><span>2</span></i><i><span>3</span></i>'
        emptyState.innerHTML = `<header class="video-node-heading"><div><b>视频生成</b><small>${mode}${totalReferences?` · ${readyReferences} / ${totalReferences} 张已就绪`:''}</small></div></header><div class="video-storyboard" style="--frame-count:${totalReferences||3}">${frames}${placeholders}<em>→</em></div><div class="video-node-summary"><em>${settings.seconds ?? '5'} 秒</em><em>${settings.resolution ?? '720p'}</em><em>${settings.aspectRatio ?? '16:9'}</em></div><p>${node.body.trim()?escapeHtml(node.body.trim()):totalReferences?(readyReferences===totalReferences?'参考图已就绪，在下方描述画面运动':`正在等待 ${totalReferences-readyReferences} 张参考图完成`):'连接图片，或直接输入视频描述'}</p>`
        emptyState.querySelectorAll<HTMLCanvasElement>('[data-reference-url]').forEach(canvas=>paintNodeMedia(canvas,canvas.dataset.referenceUrl!))
      }
    }
    element.querySelectorAll<HTMLElement>('[data-action]').forEach(button => button.hidden = false)
    for (const action of ['zoom-in', 'zoom-out']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = node.kind !== 'prompt'
    element.querySelector<HTMLElement>('[data-action="preview"]')!.hidden = !node.mediaUrl
    element.querySelector<HTMLElement>('[data-action="download"]')!.hidden = node.kind !== 'image' || !node.mediaUrl
    element.querySelector<HTMLButtonElement>('[data-action="clear-image"]')!.hidden = node.kind !== 'image' || !node.mediaUrl
    element.querySelector<HTMLButtonElement>('[data-action="clear-image"]')!.disabled = locked
    element.querySelector<HTMLElement>('[data-action="generate"]')!.hidden = node.kind === 'note' || node.kind === 'prompt'
    if (node.kind === 'image') for (const action of ['edit', 'zoom-in', 'zoom-out', 'generate', 'preview']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = true
    if (node.kind === 'video') for (const action of ['edit', 'zoom-in', 'zoom-out', 'generate', 'preview']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = true
    if (node.kind === 'image' || node.kind === 'video') {
      element.querySelector<HTMLElement>('[data-action="info"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg><span>信息</span></span>'
      element.querySelector<HTMLElement>('[data-action="download"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg><span>下载</span></span>'
      element.querySelector<HTMLElement>('[data-action="clear-image"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m7 6 1 14h8l1-14"></path><path d="M10 10v6M14 10v6"></path></svg><span>清除图片</span></span>'
      element.querySelector<HTMLElement>('[data-action="delete"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>删除</span></span>'
    }
    if (node.kind === 'prompt') {
      element.querySelector<HTMLElement>('[data-action="info"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg><span>信息</span></span>'
      element.querySelector<HTMLElement>('[data-action="edit"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg><span>编辑</span></span>'
      element.querySelector<HTMLElement>('[data-action="zoom-in"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M11 8v6"></path><path d="M8 11h6"></path></svg><span>放大</span></span>'
      element.querySelector<HTMLElement>('[data-action="zoom-out"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M8 11h6"></path></svg><span>缩小</span></span>'
      element.querySelector<HTMLElement>('[data-action="delete"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>删除</span></span>'
    }
    element.querySelector<HTMLElement>('.node-info-popover')!.textContent = `${node.kind === 'prompt' ? '标签' : node.kind === 'image' ? '图片' : node.kind === 'video' ? '视频' : '便签'}节点 · ${node.body.length} 字 · ${Math.round((node.fontScale ?? 1) * 100)}%`
    const imagePanel = element.querySelector<HTMLElement>('.image-config-panel')!; const imagePanelOpen = node.kind === 'image' && node.id === selectedId; imagePanel.classList.toggle('open', imagePanelOpen); if (!imagePanelOpen) imagePanel.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(details => details.open = false)
    const videoPanel = element.querySelector<HTMLElement>('.video-config-panel')!; const videoPanelOpen = node.kind === 'video' && node.role !== 'result' && node.id === selectedId; videoPanel.classList.toggle('open', videoPanelOpen); if (!videoPanelOpen) videoPanel.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(details => details.open = false)
    const videoResultPrompt = element.querySelector<HTMLElement>('.video-result-prompt')!; videoResultPrompt.classList.toggle('open', node.kind === 'video' && node.role === 'result' && node.id === selectedId); videoResultPrompt.querySelector<HTMLElement>('p')!.textContent = node.generationPrompt || '暂无生成提示词'
    if (node.kind === 'image') {
      if(node.model==='z-image-turbo'||node.model==='flux1-kontext-dev')node.model='gpt-image-2'
      const model = imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!, description = imagePanel.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!
      if (document.activeElement !== model) model.value = node.model ?? 'gpt-image-2'; imagePanel.querySelector<HTMLElement>('[data-image-model-label]')!.textContent = modelDisplayName(node.model ?? 'gpt-image-2'); description.placeholder = node.mediaUrl ? '描述你想如何修改这张图片' : '描述要生成的图片内容'; if (document.activeElement !== description) description.value = node.body
      const originalPrompt = imagePanel.querySelector<HTMLElement>('.image-original-prompt')!; originalPrompt.classList.toggle('visible', Boolean(node.generationPrompt || node.mediaUrl)); originalPrompt.querySelector<HTMLElement>('p')!.textContent = normalizePromptText(node.generationPrompt) || '导入图片，无生成提示词'
      for (const key of ['size', 'quality', 'background'] as const) { const input = imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!; if (document.activeElement !== input) input.value = node.imageSettings?.[key] ?? 'auto' }
      imagePanel.querySelectorAll<HTMLElement>('[data-image-setting]').forEach(button => button.classList.toggle('active', node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] === button.dataset.value || ((!node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] || node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] === 'auto') && button.dataset.value === 'auto')))
      const sizeLabel = ({ auto: '自动尺寸', '1024x1024': '1:1', '1344x1008': '4:3', '1008x1344': '3:4', '1536x1024': '3:2', '1024x1536': '2:3', '1536x864': '16:9', '864x1536': '9:16' } as Record<string, string>)[node.imageSettings?.size ?? 'auto'] ?? node.imageSettings?.size
      const qualityLabel = ({ auto: '自动质量', high: '高质量', medium: '标准质量', low: '低质量' } as Record<string, string>)[node.imageSettings?.quality ?? 'auto'] ?? node.imageSettings?.quality
      imagePanel.querySelector<HTMLElement>('[data-image-settings-label]')!.textContent = `${qualityLabel} · ${sizeLabel}`
      const generateButton = imagePanel.querySelector<HTMLButtonElement>('[data-image-generate]')!; generateButton.disabled = locked || !canGenerateNode(node); generateButton.title='开始生成'; generateButton.classList.toggle('is-running', locked); generateButton.innerHTML = locked ? '<i aria-hidden="true"></i><b>生成中</b>' : '<span>▶</span><b>生成</b>'
      element.querySelectorAll<HTMLButtonElement>('[data-image-upload],[data-image-library]').forEach(button => { button.disabled = locked; button.title = locked ? '生成期间不可更换素材' : '' })
    }
    if (node.kind === 'video') {
      const results = nodes.filter(item => item.kind === 'video' && item.role === 'result' && item.sourceNodeId === node.id), queuedCount = results.filter(item => item.status === 'queued').length, runningCount = results.filter(item => item.status === 'running').length, succeededCount = results.filter(item => item.status === 'succeeded' && Boolean(item.mediaUrl)).length
      element.querySelector<HTMLElement>('.video-generation-count')!.textContent = node.role === 'result' ? node.status === 'queued' ? '任务排队中' : node.status === 'running' ? Number(node.progress ?? 0) > 0 ? `生成中 ${Math.round(node.progress ?? 0)}%` : node.model?.startsWith('agnes-') ? '云端处理中' : '生成中 · 等待进度' : node.status === 'failed' ? '生成失败' : '生成结果' : `排队 ${queuedCount} · 生成中 ${runningCount} · 已生成 ${succeededCount}`
      element.querySelector<HTMLElement>('.video-result-model')!.textContent = modelDisplayName(node.model) || '未知模型'
      const description = videoPanel.querySelector<HTMLTextAreaElement>('[data-video-description]')!; if (document.activeElement !== description) description.value = node.body
      videoPanel.querySelector<HTMLInputElement>('[data-video-model]')!.value = node.model ?? 'agnes-video-v2.0'
      videoPanel.querySelectorAll<HTMLButtonElement>('[data-video-model-option]').forEach(option => option.classList.toggle('active', option.dataset.videoModelOption === (node.model ?? 'agnes-video-v2.0')))
      videoPanel.querySelector<HTMLElement>('.video-model-picker summary b')!.textContent = modelDisplayName(node.model ?? 'agnes-video-v2.0')
      videoPanel.querySelector<HTMLOutputElement>('[data-video-seconds]')!.value = `${node.videoSettings?.seconds ?? '5'} 秒`
      videoPanel.querySelector<HTMLElement>('.video-settings-picker summary b')!.textContent = `${node.videoSettings?.seconds ?? '5'}秒 · ${node.videoSettings?.resolution ?? '720p'} · ${node.videoSettings?.aspectRatio ?? '16:9'}`
      videoPanel.querySelectorAll<HTMLButtonElement>('[data-video-setting]').forEach(button => button.classList.toggle('active', node.videoSettings?.[button.dataset.videoSetting as 'seconds' | 'resolution' | 'aspectRatio'] === button.dataset.value))
      const button = videoPanel.querySelector<HTMLButtonElement>('[data-video-generate]')!; button.disabled = locked || !canGenerateNode(node); button.classList.toggle('is-running', locked)
    }
    const media = element.querySelector<HTMLElement>('.node-media')!
    if (node.mediaUrl) {
      media.dataset.hasMedia = 'true'
      if (media.dataset.sourceKey !== node.mediaUrl) {
        media.dataset.sourceKey = node.mediaUrl
        const video = element.querySelector<HTMLVideoElement>('.node-media-video')!
        if (node.kind === 'video') { media.style.removeProperty('background-image'); video.hidden = true; video.removeAttribute('src'); paintNodeVideo(element.querySelector<HTMLCanvasElement>('.node-media-canvas')!, node.mediaUrl) }
        else { media.style.removeProperty('background-image'); video.hidden = true; video.removeAttribute('src'); paintNodeMedia(element.querySelector<HTMLCanvasElement>('.node-media-canvas')!, node.mediaUrl) }
      }
    } else {
      delete media.dataset.hasMedia; delete media.dataset.sourceKey; media.style.removeProperty('background-image'); const video = element.querySelector<HTMLVideoElement>('.node-media-video')!; video.hidden = true; video.removeAttribute('src')
      const mediaCanvas = element.querySelector<HTMLCanvasElement>('.node-media-canvas')!; mediaCanvas.getContext('2d')!.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height)
    }
    const progress = element.querySelector<HTMLElement>('.node-progress i')!, progressTrack = element.querySelector<HTMLElement>('.node-progress')!, waitingWithoutProgress = locked && (workflowWaiting || node.status === 'queued' || Number(node.progress ?? 0) <= 0); progress.style.width = waitingWithoutProgress ? '100%' : `${node.progress ?? 0}%`
    progressTrack.classList.toggle('visible', locked); progressTrack.classList.toggle('indeterminate', waitingWithoutProgress)
  }
}

function createDomNode(node: FlowNode) {
  const element = document.createElement('article'); element.dataset.id = String(node.id); element.className = 'flow-node'
  element.innerHTML = `<div class="node-floating-tools"><button data-action="info" title="信息">ⓘ</button><button data-action="edit" title="编辑">✎</button><button data-action="zoom-in" title="放大文字">＋</button><button data-action="zoom-out" title="缩小文字">−</button><button data-action="generate" title="生成">✦</button><button data-action="preview" title="预览">⌕</button><button data-action="download" title="下载图片">↓</button><button data-action="delete" title="删除">⌫</button></div><div class="node-info-popover"></div><div class="node-port input" data-side="left"></div><div class="node-port output" data-side="right"></div><span class="node-kind"></span><h3 class="node-label-heading" hidden></h3><div class="node-media"><canvas class="node-media-canvas" width="560" height="440"></canvas></div><div class="image-empty-state"><span>▧</span><b>空图节点</b><small>生成新图片，或复用已有素材</small><div class="image-source-actions"><button type="button" data-image-upload>↑ 上传</button><button type="button" data-image-library>▦ 资产库</button></div></div><div class="node-copy"></div><div class="node-progress"><i></i></div><section class="image-config-panel"><div class="image-composer-title"><span>IMAGE</span><small>描述你想创造的画面</small></div><textarea data-image-field="description" rows="4" aria-label="图片描述" placeholder="例如：清晨薄雾中的未来城市，电影感光影…"></textarea><footer><details class="image-model-picker"><summary><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"></path></svg><b data-image-model-label>gpt-image-2</b><i>⌄</i></summary><div class="image-model-menu"><small>选择图像模型</small><button type="button" data-image-model="gpt-image-2"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg><span><b>gpt-image-2</b><small>OpenAI 图像生成</small></span><i>✓</i></button></div><select data-image-field="model" aria-label="模型" hidden><option value="gpt-image-2">gpt-image-2</option></select></details><details><summary><span>⚙</span><b data-image-settings-label>自动质量 · 自动尺寸</b><i>⌃</i></summary><div class="image-settings-popover"><header><span>图像设置</span><small>调整输出规格</small></header><label><span><b>质量</b><small>细节与生成速度</small></span><select data-image-field="quality"><option value="auto">自动质量</option><option value="high">高质量</option><option value="medium">标准质量</option><option value="low">低质量</option></select></label><label><span><b>画面尺寸</b><small>输出宽高比例</small></span><select data-image-field="size"><option value="auto">自动尺寸</option><option value="1024x1024">1:1 · 1024 × 1024</option><option value="1536x1024">3:2 · 1536 × 1024</option><option value="1024x1536">2:3 · 1024 × 1536</option></select></label><label><span><b>背景</b><small>画面底色模式</small></span><select data-image-field="background"><option value="auto">自动背景</option><option value="transparent">透明背景</option><option value="opaque">不透明背景</option></select></label></div></details><button data-image-generate type="button" title="开始生成" aria-label="生成"><span>↑</span></button></footer></section>`
  const resizeHandle=document.createElement('button');resizeHandle.type='button';resizeHandle.className='node-resize-handle';resizeHandle.title='拖动调整标签大小';resizeHandle.setAttribute('aria-label','调整标签大小');element.append(resizeHandle);resizeHandle.addEventListener('pointerdown',event=>{if(node.kind!=='prompt')return;event.preventDefault();event.stopPropagation();selectedId=node.id;updateEditor();domResize={id:node.id,startX:event.clientX,startY:event.clientY,width:node.width,height:node.height};resizeHandle.setPointerCapture(event.pointerId)})
  const mediaVideo = document.createElement('video'); mediaVideo.className = 'node-media-video'; mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'metadata'; mediaVideo.draggable = false; mediaVideo.hidden = true; element.querySelector('.node-media')!.append(mediaVideo)
  const zoomHint = document.createElement('span'); zoomHint.className = 'image-zoom-hint'; zoomHint.textContent = node.kind === 'video' ? '双击播放' : '双击放大'; element.querySelector('.node-media')!.append(zoomHint)
  const videoPanel = document.createElement('section'); videoPanel.className = 'video-config-panel'; videoPanel.innerHTML = `<header><span>VIDEO</span><small>描述画面内容、动作与镜头变化</small></header><textarea data-video-description rows="5" placeholder="例如：人物缓慢转身，镜头向前推进，柔和电影光影…"></textarea><footer><details class="video-model-picker"><summary><span>◈</span><b>视频模型</b></summary><div class="video-model-popover"><small>模型名称</small><input data-video-model value="Kling 2.1" aria-label="视频模型"></div></details><details class="video-settings-picker"><summary><span>⚙</span><b>视频属性</b></summary><div class="video-settings-popover"><header><b>视频设置</b><small>调整输出规格</small></header><div class="video-setting-row"><b>时长</b><div class="video-seconds-stepper"><button data-seconds-step="-1" type="button" aria-label="减少一秒">−</button><output data-video-seconds>5 秒</output><button data-seconds-step="1" type="button" aria-label="增加一秒">＋</button></div></div><div class="video-setting-row"><b>分辨率</b><div class="video-pill-grid"><button data-video-setting="resolution" data-value="480p" type="button">480p</button><button data-video-setting="resolution" data-value="720p" type="button">720p</button><button data-video-setting="resolution" data-value="1080p" type="button">1080p</button></div></div><div class="video-setting-row"><b>比例</b><div class="video-ratio-grid"><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="1:1" type="button"><i style="--ratio:1"></i><span>方形</span><small>1:1</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="4:3" type="button"><i style="--ratio:1.333"></i><span>横向</span><small>4:3</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="16:9" type="button"><i style="--ratio:1.778"></i><span>宽屏</span><small>16:9</small></button></div></div></div></details><button data-video-generate type="button"><span>▶</span><b>生成</b></button></footer>`; element.append(videoPanel)
  const videoResultPrompt = document.createElement('section'); videoResultPrompt.className = 'video-result-prompt'; videoResultPrompt.innerHTML = '<header><span>上次生成提示词</span><small>点击复制</small></header><p role="button" tabindex="0" title="复制上次生成提示词"></p>'; element.append(videoResultPrompt)
  videoResultPrompt.addEventListener('mousedown', event => event.stopPropagation()); videoResultPrompt.addEventListener('click', event => event.stopPropagation())
  const videoPromptText = videoResultPrompt.querySelector<HTMLElement>('p')!
  videoPromptText.addEventListener('click', () => void copyOriginalPrompt(videoPromptText.textContent||undefined))
  videoPromptText.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copyOriginalPrompt(videoPromptText.textContent||undefined) } })
  const videoModelPopover = videoPanel.querySelector<HTMLElement>('.video-model-popover')!, grokEnabled = Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0) >= 2; videoModelPopover.innerHTML = `<small>选择视频模型</small><button type="button" data-video-model-option="agnes-video-v2.0"><span><b>Agnes Video 2.0</b><small>Agnes 专用视频接口</small></span><em class="model-price free">免费</em><i>✓</i></button><button type="button" class="${grokEnabled ? '' : 'model-unavailable'}" data-video-model-option="grok-imagine-video-1.5-preview" ${grokEnabled ? '' : 'disabled'}><span><b>Grok Imagine Video 1.5 Preview</b><small>${grokEnabled ? '付费视频模型' : '创作点数不足'}</small></span><em class="model-price ${grokEnabled ? 'paid' : 'locked'}">×2</em><i>${grokEnabled ? '✓' : '⌁'}</i></button><input type="hidden" data-video-model value="agnes-video-v2.0">`
  for (const item of customApiModels.filter(item => item.kind === 'video')) videoModelPopover.querySelector('input')!.insertAdjacentHTML('beforebegin', `<button type="button" data-video-model-option="custom:${item.id}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><em class="model-price paid">自定义</em><i>✓</i></button>`)
  const videoCount = document.createElement('span'); videoCount.className = 'video-generation-count'; element.append(videoCount)
  const videoResultModel = document.createElement('span'); videoResultModel.className = 'video-result-model'; element.append(videoResultModel)
  const clearImageTool=document.createElement('button');clearImageTool.type='button';clearImageTool.dataset.action='clear-image';clearImageTool.title='清除卡片图片';clearImageTool.textContent='⌫';element.querySelector('.node-floating-tools')!.insertBefore(clearImageTool,element.querySelector('[data-action="delete"]'))
  element.querySelector('.image-config-panel')!.classList.add('image-composer-v2')
  const imageModelMenu = element.querySelector<HTMLElement>('.image-model-menu')!, imageModelSelect = element.querySelector<HTMLSelectElement>('[data-image-field="model"]')!
  const grokImageEnabled = Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0) >= 1
  imageModelMenu.insertAdjacentHTML('beforeend', '<button type="button" data-image-model="agnes-image-2.1-flash"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"></path></svg><span><b>Agnes Image 2.1 Flash</b><small>文生图 · 图生图 · 多图合成</small></span><em class="model-price free">免费</em><i>✓</i></button>')
  imageModelSelect.insertAdjacentHTML('beforeend', '<option value="agnes-image-2.1-flash">Agnes Image 2.1 Flash</option>')
  imageModelMenu.insertAdjacentHTML('beforeend', `<button type="button" class="${grokImageEnabled ? '' : 'model-unavailable'}" data-image-model="grok-imagine-image" ${grokImageEnabled ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"></path></svg><span><b>Grok Imagine Image</b><small>${grokImageEnabled ? 'Grok 图像生成' : '创作点数不足'}</small></span><em class="model-price ${grokImageEnabled ? 'paid' : 'locked'}">×1</em><i>${grokImageEnabled ? '✓' : '⌁'}</i></button>`)
  imageModelSelect.insertAdjacentHTML('beforeend', '<option value="grok-imagine-image">Grok Imagine Image</option>')
  imageModelMenu.insertAdjacentHTML('beforeend', '<button type="button" class="model-unavailable" data-image-model="gemini-3.1-flash-image" disabled><svg viewBox="0 0 24 24"><path d="M12 2c1.4 5.2 4.8 8.6 10 10-5.2 1.4-8.6 4.8-10 10-1.4-5.2-4.8-8.6-10-10 5.2-1.4 8.6-4.8 10-10Z"></path></svg><span><b>Gemini 3.1 Flash Image</b><small>CPA 图片接口适配中</small></span><em class="model-price locked">实验性</em><i>⌁</i></button>')
  imageModelSelect.insertAdjacentHTML('beforeend', '<option value="gemini-3.1-flash-image" disabled>Gemini 3.1 Flash Image · 实验性</option>')
  for (const item of customApiModels.filter(item => item.kind === 'image')) { imageModelMenu.insertAdjacentHTML('beforeend', `<button type="button" data-image-model="custom:${item.id}"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 12h8"></path></svg><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><i>✓</i></button>`); imageModelSelect.insertAdjacentHTML('beforeend', `<option value="custom:${item.id}">${escapeHtml(item.name)}</option>`) }
  const originalPrompt = document.createElement('div'); originalPrompt.className = 'image-original-prompt'; originalPrompt.innerHTML = '<header><span>上次生成提示词 <small>点击内容复制</small></span><button type="button" data-copy-current-prompt>复制当前描述</button></header><p role="button" tabindex="0" title="复制上次生成提示词"></p>'; element.querySelector('.image-config-panel textarea')!.before(originalPrompt)
  const imagePromptText = originalPrompt.querySelector<HTMLElement>('p')!
  imagePromptText.addEventListener('click', () => void copyOriginalPrompt(imagePromptText.textContent==='导入图片，无生成提示词'?undefined:imagePromptText.textContent||undefined))
  imagePromptText.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copyOriginalPrompt(imagePromptText.textContent==='导入图片，无生成提示词'?undefined:imagePromptText.textContent||undefined) } })
  originalPrompt.querySelector<HTMLButtonElement>('[data-copy-current-prompt]')!.addEventListener('click',event=>{event.stopPropagation();const description=element.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!;void copyOriginalPrompt(description.value)})
  element.querySelectorAll('.image-model-picker > summary > i,.image-config-panel footer > details:not(.image-model-picker) > summary > i').forEach(icon => icon.remove())
  element.querySelector<HTMLElement>('.image-settings-popover')!.innerHTML = `<header><span>图像设置</span><small>调整输出质量与画面比例</small></header><section class="image-setting-section"><b>质量</b><div class="image-quality-options"><button type="button" data-image-setting="quality" data-value="auto">自动</button><button type="button" data-image-setting="quality" data-value="high">高</button><button type="button" data-image-setting="quality" data-value="medium">中</button><button type="button" data-image-setting="quality" data-value="low">低</button></div><select data-image-field="quality" hidden><option value="auto">自动</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></section><section class="image-setting-section"><b>尺寸 <small>可直接输入自定义宽高</small></b><div class="image-dimension-inputs"><label><span>W</span><input type="number" min="1" max="3840" placeholder="自动" data-image-width></label><i>×</i><label><span>H</span><input type="number" min="1" max="3840" placeholder="自动" data-image-height></label></div></section><section class="image-setting-section"><b>长宽比</b><div class="image-aspect-options"><button type="button" data-image-setting="size" data-value="auto"><i class="aspect-auto">A</i><span>自动</span></button><button type="button" data-image-setting="size" data-value="1024x1024"><i class="aspect-square"></i><span>1:1</span></button><button type="button" data-image-setting="size" data-value="1344x1008"><i class="aspect-4-3"></i><span>4:3</span></button><button type="button" data-image-setting="size" data-value="1008x1344"><i class="aspect-3-4"></i><span>3:4</span></button><button type="button" data-image-setting="size" data-value="1536x1024"><i class="aspect-landscape"></i><span>3:2</span></button><button type="button" data-image-setting="size" data-value="1024x1536"><i class="aspect-portrait"></i><span>2:3</span></button><button type="button" data-image-setting="size" data-value="1536x864"><i class="aspect-16-9"></i><span>16:9</span></button><button type="button" data-image-setting="size" data-value="864x1536"><i class="aspect-9-16"></i><span>9:16</span></button><button type="button" data-custom-size><i class="aspect-auto">✎</i><span>自定义</span></button></div><select data-image-field="size" hidden><option value="auto">自动</option><option value="1024x1024">1:1</option><option value="1344x1008">4:3</option><option value="1008x1344">3:4</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option><option value="1536x864">16:9</option><option value="864x1536">9:16</option></select><p class="image-size-notice">尺寸设置可能因接口兼容性不生效，可在提示词中同时指定画面比例。</p></section><section class="image-setting-section image-background-setting"><span><b>透明背景</b><small>仅部分模型支持</small></span><button type="button" data-image-setting="background" data-value="transparent" aria-label="透明背景"><i></i></button><select data-image-field="background" hidden><option value="auto">自动</option><option value="transparent">透明</option><option value="opaque">不透明</option></select></section>`
  const settingsPopover = element.querySelector<HTMLElement>('.image-settings-popover')!; settingsPopover.querySelector('[data-image-width]')?.closest('.image-setting-section')?.remove(); settingsPopover.querySelector('[data-custom-size]')?.remove(); settingsPopover.querySelector('header small')!.textContent = '常用画面比例与输出规格'
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || domDrag) return
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,select,details,.node-port,.image-config-panel,.video-config-panel,.node-floating-tools,.node-label-heading') || target.closest('.node-copy[contenteditable="true"]')) return
    if(promptAgentSelecting){event.preventDefault();event.stopPropagation();element.setPointerCapture(event.pointerId);domDrag={id:node.id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,initialX:node.x,initialY:node.y,element,moved:false,agentSelect:true};element.classList.add('dragging');return}
    event.preventDefault(); event.stopPropagation()
    if (node.status === 'queued' || node.status === 'running') { selectedId=node.id;updateEditor();draw(); return }
    element.setPointerCapture(event.pointerId); domDrag = { id: node.id, pointerId:event.pointerId, startX: event.clientX, startY: event.clientY, initialX: node.x, initialY: node.y, element, moved: false }; element.classList.add('dragging'); draw()
  })
  element.addEventListener('dblclick', event => {
    if (performance.now() < suppressNodeReleaseUntil) { event.preventDefault(); event.stopPropagation(); return }
    if ((event.target as HTMLElement).closest('.image-config-panel,.video-config-panel,.node-floating-tools,.node-port')) return
    if (node.kind === 'prompt') { event.preventDefault(); event.stopPropagation(); selectedId = node.id; updateEditor(); enterTextEdit(node, element); return }
    if ((node.kind !== 'image' && node.kind !== 'video') || !node.mediaUrl) return
    const rect = element.querySelector<HTMLElement>('.node-media')!.getBoundingClientRect(), insideImage = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    if (!insideImage) return
    event.preventDefault(); event.stopPropagation(); selectedId = node.id; updateEditor(); openAssetPreview(node.mediaUrl, node.title, node.kind)
  })
  element.addEventListener('dragstart', event => event.preventDefault())
  element.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation() })
  const labelHeading=element.querySelector<HTMLElement>('.node-label-heading')!
  labelHeading.addEventListener('dblclick',event=>{if(node.kind!=='prompt')return;event.preventDefault();event.stopPropagation();labelHeading.contentEditable='true';labelHeading.classList.add('editing');labelHeading.focus();const range=document.createRange();range.selectNodeContents(labelHeading);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range)})
  labelHeading.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();labelHeading.blur()}})
  labelHeading.addEventListener('input',()=>{node.title=labelHeading.innerText;setSaveState('editing','编辑中…')})
  labelHeading.addEventListener('blur',()=>{if(!labelHeading.isContentEditable)return;node.title=labelHeading.innerText.trim()||'未命名标签';labelHeading.contentEditable='false';labelHeading.classList.remove('editing');scheduleSave();draw()})
  element.querySelectorAll<HTMLElement>('.node-port').forEach(port => {const output=port.dataset.side==='right';port.dataset.label=output?'输出':'输入';port.title=output?'输出：拖动到其他卡片的输入端':'输入：接收其他卡片的输出';port.setAttribute('aria-label',output?'输出端点':'输入端点');port.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation();if(!output)return;selectedId = 0; updateEditor(); connectionSnap = null; connecting = { nodeId: node.id, side:'right', pointer: { x: event.clientX, y: event.clientY } }; draw() })})
  element.querySelector('[data-action="info"]')!.addEventListener('click', event => { event.stopPropagation(); openNodeInfo(node) })
  element.querySelector('[data-action="edit"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); if (node.kind === 'prompt') enterTextEdit(node, element); else promptInput.focus() })
  element.querySelector('[data-action="zoom-in"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.min(2, (node.fontScale ?? 1) + .1); scheduleSave(); draw() })
  element.querySelector('[data-action="zoom-out"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.max(.7, (node.fontScale ?? 1) - .1); scheduleSave(); draw() })
  element.querySelector('[data-action="generate"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); void generate() })
  element.querySelector('[data-action="preview"]')!.addEventListener('click', event => { event.stopPropagation(); if (node.mediaUrl) openAssetPreview(node.mediaUrl, node.title) })
  element.querySelector('[data-action="download"]')!.addEventListener('click', event => { event.stopPropagation(); if (node.mediaUrl) void downloadNodeImage(node) })
  const clearImageButton=element.querySelector<HTMLButtonElement>('[data-action="clear-image"]')!,requestClearImage=async(event:Event)=>{event.preventDefault();event.stopPropagation();const current=nodes.find(item=>item.id===Number(element.dataset.id));if(!current?.mediaUrl||current.status==='queued'||current.status==='running')return;const confirmed=await askProjectDialog({title:'清除当前卡片的图片？',description:'资产库中的原图不会删除。模型、图像设置、参考连线和上次完整提示词都会保留，可修改后重新生成。',confirm:'清除图片'});if(!confirmed)return;const latest=nodes.find(item=>item.id===current.id);if(!latest?.mediaUrl||latest.status==='queued'||latest.status==='running')return;imageCache.delete(latest.mediaUrl);latest.body=normalizePromptText(latest.generationPrompt||latest.body);delete latest.mediaUrl;delete latest.jobId;latest.status='idle';latest.progress=0;latest.agentAuto=false;selectedId=latest.id;updateEditor();scheduleSave();draw();showToast('图片已清除，上次完整提示词已回填','success')};clearImageButton.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation()});clearImageButton.addEventListener('pointerup',requestClearImage);clearImageButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(event.detail===0)void requestClearImage(event)})
  element.querySelector('[data-action="delete"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; deleteSelectedNode() })
  const imagePanel = element.querySelector<HTMLElement>('.image-config-panel')!
  imagePanel.addEventListener('mousedown', event => event.stopPropagation())
  imagePanel.addEventListener('click', event => event.stopPropagation())
  imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!.addEventListener('change', event => { node.model = (event.target as HTMLSelectElement).value; scheduleSave() })
  imagePanel.querySelectorAll<HTMLButtonElement>('[data-image-model]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); const select = imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!; select.value = button.dataset.imageModel!; select.dispatchEvent(new Event('change')); button.blur(); imagePanel.querySelector<HTMLDetailsElement>('.image-model-picker')!.open = false; draw() }))
  imagePanel.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!.addEventListener('input', event => { node.body = (event.target as HTMLTextAreaElement).value; setSaveState('editing', '编辑中…'); scheduleSave(); draw() })
  for (const key of ['size', 'quality', 'background'] as const) imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!.addEventListener('change', event => { node.imageSettings = { ...(node.imageSettings ?? {}), [key]: (event.target as HTMLSelectElement).value }; scheduleSave() })
  imagePanel.querySelectorAll<HTMLButtonElement>('[data-image-setting]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); const key = button.dataset.imageSetting as 'size' | 'quality' | 'background', current = node.imageSettings?.[key] ?? 'auto', value = key === 'background' && current === 'transparent' ? 'auto' : button.dataset.value!; const select = imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!; select.value = value; select.dispatchEvent(new Event('change')); draw() }))
  imagePanel.querySelector('[data-image-generate]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); void generate() })
  element.querySelector('[data-image-upload]')!.addEventListener('click', event => { event.stopPropagation(); beginImageNodeUpload(node.id) })
  element.querySelector('[data-image-library]')!.addEventListener('click', event => { event.stopPropagation(); void beginImageNodeLibrary(node.id) })
  videoPanel.addEventListener('pointerdown', event => {
    const target = event.target as Node
    videoPanel.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(details => { if (!details.contains(target)) details.open = false })
    event.stopPropagation()
  }); videoPanel.addEventListener('mousedown', event => event.stopPropagation()); videoPanel.addEventListener('click', event => event.stopPropagation())
  videoPanel.querySelector<HTMLTextAreaElement>('[data-video-description]')!.addEventListener('input', event => { node.body = (event.target as HTMLTextAreaElement).value; scheduleSave(); draw() })
  videoPanel.querySelector<HTMLInputElement>('[data-video-model]')!.addEventListener('input', event => { node.model = (event.target as HTMLInputElement).value; scheduleSave() })
  videoPanel.querySelectorAll<HTMLButtonElement>('[data-video-model-option]').forEach(option => option.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if(option.disabled)return;const input = videoPanel.querySelector<HTMLInputElement>('[data-video-model]')!; input.value = option.dataset.videoModelOption!; input.dispatchEvent(new Event('input')); videoPanel.querySelector<HTMLDetailsElement>('.video-model-picker')!.open = false; draw() }))
  videoPanel.querySelectorAll<HTMLButtonElement>('[data-seconds-step]').forEach(button => button.addEventListener('click', () => { const current = Number(node.videoSettings?.seconds ?? 5), limits = generationCapabilities.video?.seconds ?? { min: 1, max: 18 }; const seconds = Math.min(limits.max, Math.max(limits.min, current + Number(button.dataset.secondsStep))); node.videoSettings = { resolution: '720p', aspectRatio: '16:9', ...(node.videoSettings ?? {}), seconds: String(seconds) }; scheduleSave(); draw() }))
  videoPanel.querySelectorAll<HTMLButtonElement>('[data-video-setting]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.videoSetting as 'seconds' | 'resolution' | 'aspectRatio'; node.videoSettings = { seconds: '5', resolution: '720p', aspectRatio: '16:9', ...(node.videoSettings ?? {}), [key]: button.dataset.value! }; scheduleSave(); draw() }))
  videoPanel.querySelector('[data-video-generate]')!.addEventListener('click', () => { selectedId = node.id; updateEditor(); void generate() })
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
  return { id: node.publicId, type: node.kind === 'prompt' ? 'label' : node.kind, title: node.title, position: { x: node.x, y: node.y }, width: node.width, height: node.height, metadata: { content: node.body, status: node.status ?? 'idle', fontSize: Math.round(12 * (node.fontScale ?? 1)) } }
}
function openNodeInfo(node: FlowNode) {
  const info = nodeInfoData(node)
  const typeLabel = node.kind === 'prompt' ? '标签' : node.kind === 'image' ? '图片' : node.kind === 'video' ? '视频' : '便签'
  nodeInfoDetails.innerHTML = `<dl><div><dt>ID</dt><dd>${escapeHtml(info.id)}</dd></div><div><dt>名称</dt><dd>${escapeHtml(info.title)}</dd></div><div><dt>类型</dt><dd>${typeLabel}</dd></div><div><dt>尺寸</dt><dd>${Math.round(info.width)} × ${Math.round(info.height)}</dd></div><div><dt>位置</dt><dd>${Math.round(info.position.x)}, ${Math.round(info.position.y)}</dd></div><div><dt>状态</dt><dd><i></i>${escapeHtml(info.metadata.status)}</dd></div></dl>`
  nodeInfoJson.textContent = JSON.stringify(info, null, 2); nodeInfoDetails.hidden = false; nodeInfoJson.hidden = true
  nodeInfoModal.querySelectorAll('[data-info-tab]').forEach(button => button.classList.toggle('active', (button as HTMLElement).dataset.infoTab === 'details'))
  nodeInfoModal.classList.add('open'); scheduleSave()
}
function closeNodeInfo() { nodeInfoModal.classList.remove('open') }
document.querySelector('#close-node-info')!.addEventListener('click', closeNodeInfo)
nodeInfoModal.addEventListener('click', event => { if (event.target === nodeInfoModal) closeNodeInfo() })
nodeInfoModal.querySelectorAll<HTMLElement>('[data-info-tab]').forEach(button => button.addEventListener('click', () => { const json = button.dataset.infoTab === 'json'; nodeInfoDetails.hidden = json; nodeInfoJson.hidden = !json; nodeInfoModal.querySelectorAll('[data-info-tab]').forEach(item => item.classList.toggle('active', item === button)) }))

function defaultNodeCopy(kind: NodeKind) { return kind === 'prompt' ? '双击记录标签或说明' : kind === 'image' ? '空图节点' : kind === 'video' ? '连接图片并填写描述，生成视频' : '双击添加说明文字' }

function paintNodeMedia(target: HTMLCanvasElement, url: string) {
  const displayUrl = mediaThumbnailUrl(url)
  let image = imageCache.get(displayUrl)
  if (!image) {
    image = new Image(); imageCache.set(displayUrl, image); pendingMediaLoads.add(displayUrl); refreshAppearanceButton()
    image.onload = () => { pendingMediaLoads.delete(displayUrl); repaintMediaUrl(url); refreshAppearanceButton() }
    image.onerror = () => { pendingMediaLoads.delete(displayUrl); repaintMediaUrl(url); refreshAppearanceButton() }
    image.src = displayUrl
  }
  drawMediaImage(target, image)
}
function mediaThumbnailUrl(url: string) { return url.replace(/^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/, '$1/thumbnail') }
function drawMediaImage(target: HTMLCanvasElement, image: HTMLImageElement) {
  const context = target.getContext('2d')!
  const fill = colorTheme === 'dark' ? '#111a1c' : '#e7efeb'
  context.fillStyle = fill; context.fillRect(0, 0, target.width, target.height)
  if (image.complete && image.naturalWidth) { const scale = Math.min(target.width / image.naturalWidth, target.height / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale; context.drawImage(image, (target.width - width) / 2, (target.height - height) / 2, width, height) }
  else if (image.complete) { context.fillStyle = '#777'; context.font = '24px system-ui'; context.textAlign = 'center'; context.fillText('图片加载失败', target.width / 2, target.height / 2) }
}
function paintNodeVideo(target:HTMLCanvasElement,url:string){paintNodeMedia(target,url)}
function repaintMediaUrl(url: string) { const image = imageCache.get(mediaThumbnailUrl(url)); if (!image) return; nodes.filter(node => node.mediaUrl === url).forEach(node => { const target = nodeLayer.querySelector<HTMLCanvasElement>(`.flow-node[data-id="${node.id}"] .node-media-canvas`); if (target) drawMediaImage(target, image!) }) }
function repaintAllMedia() { nodes.filter(node => node.mediaUrl).forEach(node => repaintMediaUrl(node.mediaUrl!)) }

window.addEventListener('pointermove', event => {
  if (domResize) { const node = nodes.find(item => item.id === domResize!.id); if (!node) return; const width = Math.max(220, domResize.width + (event.clientX - domResize.startX) / camera.zoom); let height = Math.max(160, domResize.height + (event.clientY - domResize.startY) / camera.zoom); if (node.mediaUrl && !event.shiftKey) height = Math.max(180, domResize.height * width / domResize.width); node.width = width; node.height = height; setSaveState('editing', '编辑中…'); draw() }
  if (connecting) { updateConnectionPointer(event.clientX, event.clientY); draw() }
})
window.addEventListener('pointerup', event => {
  if (domResize) { domResize = null; scheduleSave() }
  if (!connecting) return
  const snappedNode = connectionSnap ? nodes.find(node => node.id === connectionSnap!.nodeId) : undefined; const target = snappedNode ? { node: snappedNode, side: connectionSnap!.side } : hitPort(event.clientX, event.clientY, connectionSnapRadius, connecting.nodeId)
  if (target) { const next=directedLink(connecting.nodeId,connecting.side,target.node.id,target.side);if(next&&!links.some(link => link.from === next.from && link.to === next.to)){links.push(next);scheduleSave()} }
  connecting = null; connectionSnap = null; draw()
})
window.addEventListener('pointermove', event => {
  if (!domDrag || event.pointerId !== domDrag.pointerId) return
  // Edge can report a final mousemove with buttons=0 before mouseup. Keep the
  // release guarded here too, otherwise its synthetic drop/click may navigate
  // to the image URL after a node drag.
  if (event.buttons === 0) {
    if (domDrag.moved) suppressNodeReleaseUntil = performance.now() + 700
    else if(!domDrag.agentSelect){if(multiSelectMode)toggleBatchNode(domDrag.id);else{selectedId=domDrag.id;updateEditor()}}
    domDrag.element.classList.remove('dragging'); domDrag = null
    if (domDragFrame !== null) cancelAnimationFrame(domDragFrame); domDragFrame = null
    scheduleSave(); draw(); return
  }
  const drag = domDrag, dx = (event.clientX - drag.startX) / camera.zoom, dy = (event.clientY - drag.startY) / camera.zoom
  if (!drag.moved&&(Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3)){drag.moved=true;if(!drag.agentSelect&&selectedId===drag.id){selectedId=0;updateEditor();draw()}}
  if (domDragFrame !== null) cancelAnimationFrame(domDragFrame)
  domDragFrame = requestAnimationFrame(() => { const node = nodes.find(item => item.id === drag.id); if (node) { node.x = drag.initialX + dx; node.y = drag.initialY + dy; setSaveState('editing', '编辑中…'); draw() } domDragFrame = null })
})
window.addEventListener('pointerup', event => {
  if (!domDrag || event.pointerId !== domDrag.pointerId || event.button !== 0) return
  if (domDragFrame !== null) { cancelAnimationFrame(domDragFrame); domDragFrame = null }
  const drag = domDrag, node = nodes.find(item => item.id === drag.id)
  if (node && drag.moved) { node.x = drag.initialX + (event.clientX - drag.startX) / camera.zoom; node.y = drag.initialY + (event.clientY - drag.startY) / camera.zoom }
      if(drag.agentSelect&&!drag.moved){if(promptAgentContextSelection.has(drag.id))promptAgentContextSelection.delete(drag.id);else if(promptAgentContextSelection.size<8)promptAgentContextSelection.add(drag.id);else showToast('参考素材最多选择 8 个','warning');renderPromptAgentContext(false)}else if(!drag.agentSelect&&!drag.moved){if(multiSelectMode)toggleBatchNode(drag.id);else{selectedId=drag.id;updateEditor()}}
  if (drag.moved) suppressNodeReleaseUntil = performance.now() + 700
  drag.element.classList.remove('dragging'); domDrag = null; scheduleSave(); draw()
})
window.addEventListener('pointercancel', event => { if (!domDrag || event.pointerId !== domDrag.pointerId) return; domDrag.element.classList.remove('dragging'); domDrag = null; if (domDragFrame !== null) cancelAnimationFrame(domDragFrame); domDragFrame = null; draw() })
window.addEventListener('blur', () => { if (domDrag) domDrag.element.classList.remove('dragging'); domDrag = null; if (domDragFrame !== null) cancelAnimationFrame(domDragFrame); domDragFrame = null })
window.addEventListener('dragstart', event => { if ((event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) { event.preventDefault(); event.stopImmediatePropagation(); if (event.dataTransfer) event.dataTransfer.clearData() } }, true)
window.addEventListener('dragend', event => { if ((event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
window.addEventListener('dragover', event => { if ((event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) { event.preventDefault(); event.stopImmediatePropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'none' } }, true)
window.addEventListener('drop', event => { event.preventDefault(); if (performance.now() < suppressNodeReleaseUntil || (event.target as HTMLElement | null)?.closest('.flow-node,.asset-item')) event.stopImmediatePropagation() }, true)
for (const type of ['click', 'auxclick', 'dblclick'] as const) window.addEventListener(type, event => { if (performance.now() < suppressNodeReleaseUntil) { event.preventDefault(); event.stopImmediatePropagation() } }, true)

function deleteSelectedNode() {
  const index = nodes.findIndex(node => node.id === selectedId)
  if (index < 0) return
  if (canvasHasActiveGeneration()) { showToast('画布正在生成，任务完成后即可删除节点', 'warning'); return }
  const targets = cascadeSelectionIds(new Set([nodes[index].id]))
  const cascadeCount = targets.size - 1
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) if (targets.has(nodes[nodeIndex].id)) nodes.splice(nodeIndex, 1)
  for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--) {
    if (targets.has(links[linkIndex].from) || targets.has(links[linkIndex].to)) links.splice(linkIndex, 1)
  }
  selectedId = 0
  for (const id of targets) batchSelectedIds.delete(id)
  updateEditor(); scheduleSave(); draw()
  if (cascadeCount) showCanvasGuide({key:'delete-cascade',title:`已删除 ${targets.size} 个卡片`,detail:`同时清理了 ${cascadeCount} 个只依赖该上游的下游卡片。`,tone:'online',duration:2600})
}

function selectedNode() { return nodes.find(node => node.id === selectedId) }
function canGenerateNode(node: FlowNode) { const credits = Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0), modelCost = node.model === 'grok-imagine-video-1.5-preview' ? 2 : node.model === 'grok-imagine-image' ? 1 : 0; return node.model !== 'gemini-3.1-flash-image' && (node.kind === 'image' || node.kind === 'video') && node.role !== 'result' && credits >= modelCost && Boolean(node.body.trim()) }
function updateEditor() {
  const node = selectedNode()
  if (!node) {
    titleInput.value = ''; promptInput.value = ''; jobLabel.textContent = '画布中没有节点'; jobProgress.style.width = '0%'
    titleInput.disabled = true; promptInput.disabled = true; modelInput.disabled = true
    return
  }
  const locked = nodeIsActivelyGenerating(node) && !(node.kind === 'video' && node.role !== 'result')
  titleInput.disabled = locked; promptInput.disabled = locked; modelInput.disabled = locked; generateButton.disabled = locked || !canGenerateNode(node)
  titleInput.value = node.title
  promptInput.value = node.body
  modelInput.value = node.model ?? (node.kind === 'video' ? 'agnes-video-v2.0' : 'gpt-image-2')
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
    document.nodes?.forEach(node => { if (node.kind === 'video' && (!node.model || node.model === 'Kling 2.1')) node.model = 'agnes-video-v2.0'; if (node.kind === 'video' && node.role === 'result') node.body = '' })
    nodes.splice(0, nodes.length, ...(document.nodes ?? [])); nodes.forEach(node => { if (node.kind === 'prompt' && node.title === '文本') node.title = '标签'; if (node.kind === 'prompt' && node.body === '输入你的创意描述') node.body = '记录标签、分组标题或画布备注'; if ((node.kind === 'image' || node.kind === 'video') && !node.mediaUrl && node.body === '等待配置模型与生成参数') node.body = ''; if (node.kind === 'video') node.videoSettings = { seconds: '5', resolution: '720p', aspectRatio: '16:9', ...(node.videoSettings ?? {}) }; if (node.kind === 'video' && node.role !== 'result') { node.status = 'idle'; node.progress = 0; delete node.jobId } if (node.imageSettings?.size && !['auto', '1024x1024', '1344x1008', '1008x1344', '1536x1024', '1024x1536', '1536x864', '864x1536'].includes(node.imageSettings.size)) node.imageSettings.size = 'auto' }); await Promise.all(nodes.filter(node => node.jobId && (!node.generationPrompt || node.body === '生成完成 · 结果已回写')).map(async node => { try { const jobResponse = await fetch(`/api/jobs/${node.jobId}`); if (!jobResponse.ok) return; const job = await jobResponse.json() as { prompt?: string }; if (job.prompt) { node.generationPrompt = job.prompt; if (node.body === '生成完成 · 结果已回写' || node.body === job.prompt) node.body = '' } } catch { /* 保留现有内容，等待用户手动修正 */ } })); const migrated = (document.links ?? []).map(link => {const current=Array.isArray(link)?{from:link[0],to:link[1],fromSide:'right' as PortSide,toSide:'left' as PortSide}:link;return current.fromSide==='left'&&current.toSide==='right'?{...current,from:current.to,to:current.from,fromSide:'right' as PortSide,toSide:'left' as PortSide}:current}); links.splice(0, links.length, ...migrated); nextId = nodes.length ? Math.max(...nodes.map(node => node.id)) + 1 : 1
    nodes.filter(node=>node.kind==='image'&&node.title.startsWith('分镜 ')&&node.status==='failed'&&!node.jobId&&links.some(link=>link.to===node.id&&nodes.some(source=>source.id===link.from&&source.status==='failed'))).forEach(node=>{node.status='waiting';node.agentAuto=true})
    let repositionedResult = false
    nodes.filter(node => node.kind === 'video' && node.role === 'result' && node.sourceNodeId).forEach(node => { const source = nodes.find(item => item.id === node.sourceNodeId); if (source && Math.abs(node.y - source.y) > 780) { const position = findRevisionPosition(source, node.id); node.x = position.x; node.y = position.y; repositionedResult = true } })
    nodes.filter(node => node.kind === 'video' && node.status === 'failed' && !node.mediaUrl && links.some(link => link.to === node.id && nodes.some(source => source.id === link.from && source.kind === 'video'))).forEach(node => { node.role = 'result'; node.sourceNodeId = links.find(link => link.to === node.id)?.from; removeFailedResult(node) })
    if (document.camera) { Object.assign(camera, document.camera); zoomTarget = camera.zoom }
    selectedId = 0; setSaveState('saved', '已自动保存'); updateEditor(); draw(); if (repositionedResult) scheduleSave()
    nodes.filter(node => node.jobId && (node.status === 'queued' || node.status === 'running')).forEach(pollJob)
    queueMicrotask(runAgentWorkflow)
  } catch { setSaveState('error', '离线模式') }
}

async function generate(sourceOverride?:FlowNode) {
  const source = sourceOverride ?? selectedNode()
  if (!source || !canGenerateNode(source)) { if (source?.kind === 'image' || source?.kind === 'video') promptInput.focus(); return }
  jobLabel.textContent = '正在提交…'
  source.agentAuto = false
  if (source.kind === 'video' && source.role !== 'result') { source.status = 'idle'; source.progress = 0; delete source.jobId }
  const createsOutput = source.kind === 'video' || (source.kind === 'image' && Boolean(source.mediaUrl))
  const node = createsOutput ? createRevisionNode(source) : source
  node.status = 'queued'; node.progress = 0; updateEditor(); draw()
  try {
    const upstream = links.filter(link => link.to === source.id && link.from !== node.id).map(link => ({link,node:nodes.find(item => item.id === link.from)})).filter((item):item is {link:FlowLink;node:FlowNode}=>Boolean(item.node)).sort((left,right)=>{const leftOrder=left.link.inputOrder,rightOrder=right.link.inputOrder;if(leftOrder!==undefined||rightOrder!==undefined)return (leftOrder??Number.MAX_SAFE_INTEGER)-(rightOrder??Number.MAX_SAFE_INTEGER);return left.node.y-right.node.y||left.node.x-right.node.x||left.node.id-right.node.id}).map(item=>item.node)
    const inputMedia=(source.kind==='image'&&source.mediaUrl?[source]:[]).concat(upstream.filter(item=>Boolean(item.mediaUrl))),uniqueInputMedia=inputMedia.filter((item,index,list)=>list.findIndex(candidate=>candidate.mediaUrl===item.mediaUrl)===index)
    const inputUrls = source.kind === 'video'
      ? upstream.filter(item => item.kind === 'image').map(item => item.mediaUrl).filter((url): url is string => Boolean(url)).filter((url,index,list)=>list.indexOf(url)===index)
      : uniqueInputMedia.map(item=>item.mediaUrl!).filter(Boolean)
    const promptWithoutStaleGuide=normalizePromptText(source.body).replace(/\n?严格参考(?:连接|实际输入)素材：[^\n]*不得互换或重新设计。?/g,'').replace(/\n?角色实例约束：[^\n]*/g,'').trim(),actualGuide=source.kind==='image'&&uniqueInputMedia.length?`\n严格参考实际输入素材：${uniqueInputMedia.map((item,index)=>`输入图 ${index+1}「${item.title}」`).join('、')}。保持人物身份、服装、道具外观和场景结构一致，不得互换或重新设计。`:''
    const characterReferenceCount=uniqueInputMedia.filter(item=>/^角色\s*\d*\s*·/.test(item.title)).length,roleInstanceGuide=source.kind==='image'&&characterReferenceCount?`\n角色实例约束：每张已连接角色设定图只对应画面中该角色的一个实例，不得复制出多个相同人物。路人、群众、行人、围观者均为匿名背景角色，外貌、发型和服装必须彼此有差异，禁止套用或复制任何已连接角色的脸、发型、体型与服装。`:''
    const resolvedPrompt = `${promptWithoutStaleGuide}${actualGuide}${roleInstanceGuide}`.trim()
    const requestPrompt = source.kind === 'image' ? appendImageSizeHint(resolvedPrompt, node.imageSettings?.size) : resolvedPrompt
    const parameters = node.kind === 'video'
      ? Object.fromEntries(Object.entries({ seconds: node.videoSettings?.seconds, resolution: node.videoSettings?.resolution, aspect_ratio: node.videoSettings?.aspectRatio }).filter(([, value]) => value && value !== 'auto'))
      : Object.fromEntries(Object.entries(node.imageSettings ?? {}).filter(([, value]) => value && value !== 'auto'))
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId, nodeId: node.id, kind: node.kind === 'video' ? 'video' : 'image', prompt: requestPrompt, model: node.model, inputUrls, parameters }) })
    const job = await response.json().catch(() => ({})) as { id: string; status: string; progress: number; creditsAvailable?:number; error?:string }
    if (!response.ok) throw new Error(job.error || '任务提交失败')
    if (authUser && typeof job.creditsAvailable === 'number') { authUser = { ...authUser, reservedCredits:Math.max(0,Number(authUser.credits ?? 0)-job.creditsAvailable) }; renderAuthenticatedUser(); refreshNodeModelMenus() }
    node.jobId = job.id; node.status = job.status; node.progress = job.progress; node.generationPrompt = resolvedPrompt; node.agentAuto=false; if (node.role !== 'result') node.body = ''; updateEditor(); scheduleSave(); draw(); pollJob(node)
  } catch (error) { node.status = 'failed'; node.progress = 0; jobLabel.textContent = '提交失败，请检查 API'; showToast('任务提交失败，请检查接口配置', 'error', error instanceof Error ? error.message : '未知错误'); if (node.role === 'result') removeFailedResult(node, source.id); updateEditor(); scheduleSave(); draw() }
}

function appendImageSizeHint(prompt: string, size?: string) {
  if (!size || size === 'auto') return prompt
  const ratio = ({
    '1024x1024': '1:1',
    '1344x1008': '4:3',
    '1008x1344': '3:4',
    '1536x1024': '3:2',
    '1024x1536': '2:3',
    '1536x864': '16:9',
    '864x1536': '9:16',
  } as Record<string, string>)[size]
  const dimensions = size.replace('x', '×')
  return `${prompt}\n\n输出要求：画面宽高比为 ${ratio ?? dimensions}，尺寸为 ${dimensions}，请直接按此比例构图，不要裁切。`
}

function createRevisionNode(source: FlowNode) {
  const position = findRevisionPosition(source)
  const kind: 'image' | 'video' = source.kind === 'video' ? 'video' : 'image'
  const revision: FlowNode = { id: nextId++, publicId: makePublicId(kind), kind, role: kind === 'video' ? 'result' : undefined, sourceNodeId: kind === 'video' ? source.id : undefined, x: position.x, y: position.y, width: 280, height: 220, title: kind === 'video' ? '视频生成结果' : '图片修改结果', body: '', accent: kind === 'video' ? '#ffb774' : '#8ee7ff', model: source.model ?? (kind === 'video' ? 'agnes-video-v2.0' : 'gpt-image-2'), imageSettings: kind === 'image' ? { ...(source.imageSettings ?? {}) } : undefined, videoSettings: kind === 'video' ? { ...(source.videoSettings ?? {}) } : undefined, status: 'queued', progress: 0 }
  nodes.push(revision)
  links.push({ from: source.id, to: revision.id, fromSide: 'right', toSide: 'left' })
  selectedId = revision.id; updateEditor(); scheduleSave(); draw()
  return revision
}

function removeFailedResult(node: FlowNode, sourceId = node.sourceNodeId) { const index = nodes.indexOf(node); if (index >= 0) nodes.splice(index, 1); for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--) if (links[linkIndex].from === node.id || links[linkIndex].to === node.id) links.splice(linkIndex, 1); if (selectedId === node.id) selectedId = sourceId ?? 0 }

const agentWorkflowSubmitting=new Set<number>()
function runAgentWorkflow(){for(const node of nodes.filter(item=>item.agentAuto&&!agentWorkflowSubmitting.has(item.id))){const upstream=links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).filter((item):item is FlowNode=>Boolean(item));if(upstream.some(item=>item.status==='failed')){node.status='waiting';continue}if(upstream.some(item=>item.kind==='image'&&!item.mediaUrl))continue;agentWorkflowSubmitting.add(node.id);if(node.kind!=='video'||node.role==='result')node.status='queued';void generate(node).finally(()=>{agentWorkflowSubmitting.delete(node.id);scheduleSave();draw()})}}

function findRevisionPosition(source: FlowNode, excludeId?: number) {
  const columnStep = 390, rowStep = 260, rowOffsets = [0, 1, -1, 2, -2]
  for (let column = 0; column < 8; column++) for (const row of rowOffsets) {
    const candidate = { x: source.x + source.width + 110 + column * columnStep, y: source.y + row * rowStep }
    const occupied = nodes.some(node => node.id !== source.id && node.id !== excludeId && candidate.x < node.x + node.width + 24 && candidate.x + 280 + 24 > node.x && candidate.y < node.y + node.height + 24 && candidate.y + 220 + 24 > node.y)
    if (!occupied) return candidate
  }
  return { x: source.x + source.width + 110, y: source.y }
}

function pollJob(node: FlowNode) {
  if (!node.jobId) return
  const jobId = node.jobId
  const previousTimer = activeJobPolls.get(jobId); if (previousTimer) window.clearInterval(previousTimer)
  let failures = 0, failureNotified = false
  const timer = window.setInterval(async () => {
    if (!node.jobId || node.jobId !== jobId) { window.clearInterval(timer); activeJobPolls.delete(jobId); return }
    try {
      const response = await fetch(`/api/jobs/${jobId}`)
      if (!response.ok) throw new Error(`job status ${response.status}`)
      const job = await response.json() as { status: string; progress: number; result_url?: string; error?: string }
      failures = 0; failureNotified = false; node.status = job.status
      if (node.kind === 'image' && job.status === 'running' && job.progress === 20 && !retryNotifiedJobs.has(jobId)) {
        retryNotifiedJobs.add(jobId)
        showToast('首次生成请求超时，正在自动重试一次', 'warning')
      }
      node.progress = job.progress
      updateEditor(); draw()
      if (job.status === 'succeeded' || job.status === 'failed') {
        window.clearInterval(timer); activeJobPolls.delete(jobId); retryNotifiedJobs.delete(jobId)
        if (job.status === 'succeeded' && job.result_url) {
          node.mediaUrl = job.result_url
          imageCache.delete(job.result_url)
          await loadAssets()
          if (node.kind === 'video') showToast('视频已生成并加入资产库', 'success')
        }
        if (job.status === 'failed') { const message = job.error || '视频生成失败'; jobLabel.textContent = `生成失败：${message}`; showToast(message, 'error'); if (node.role === 'result') removeFailedResult(node) }
        try { const userResponse=await fetch('/api/users/me'); if(userResponse.ok){authUser=await userResponse.json() as AuthUser;renderAuthenticatedUser();refreshNodeModelMenus()} } catch { /* 下次刷新同步余额 */ }
        updateEditor(); draw(); scheduleSave(); runAgentWorkflow()
      }
    } catch { failures++; jobLabel.textContent = '状态同步中断，正在重试…'; if (failures >= 5 && !failureNotified) { failureNotified = true; showToast('任务状态暂时无法同步，服务恢复后将自动重试', 'error') } }
  }, 1500)
  activeJobPolls.set(jobId, timer)
}

function resumeActiveJobPolls() { nodes.filter(node => node.jobId && (node.status === 'queued' || node.status === 'running')).forEach(pollJob) }
window.addEventListener('online', resumeActiveJobPolls)
window.addEventListener('focus', resumeActiveJobPolls)

function refreshBatchSelection(){for(const id of [...batchSelectedIds])if(!nodes.some(node=>node.id===id))batchSelectedIds.delete(id);batchToolbar.classList.toggle('open',batchSelectedIds.size>0);const count=batchToolbar.querySelector<HTMLElement>('[data-batch-count]')!;count.textContent=innerWidth<=780?`已选 ${batchSelectedIds.size}`:`已选 ${batchSelectedIds.size} 项`;count.title=`已选择 ${batchSelectedIds.size} 个卡片`;if(!batchSelectedIds.size){draw();return}const selected=nodes.filter(node=>batchSelectedIds.has(node.id)),left=Math.min(...selected.map(node=>screen(node).x)),right=Math.max(...selected.map(node=>screen({x:node.x+node.width,y:node.y}).x)),top=Math.min(...selected.map(node=>screen(node).y));batchToolbar.style.left=`${Math.max(12,Math.min(innerWidth-batchToolbar.offsetWidth-12,(left+right)/2-batchToolbar.offsetWidth/2))}px`;batchToolbar.style.top=`${Math.max(72,top-58)}px`;draw()}
function clearBatchSelection(){batchSelectedIds.clear();batchToolbar.classList.remove('open');draw()}
function toggleBatchNode(id:number){if(batchSelectedIds.has(id))batchSelectedIds.delete(id);else batchSelectedIds.add(id);selectedId=0;updateEditor();refreshBatchSelection()}
function updateMarqueeSelection(){if(!marquee?.active)return;const origin=screen(marquee.worldStart),left=Math.min(origin.x,marquee.current.x),top=Math.min(origin.y,marquee.current.y),right=Math.max(origin.x,marquee.current.x),bottom=Math.max(origin.y,marquee.current.y),currentWorld=world(marquee.current),worldLeft=Math.min(marquee.worldStart.x,currentWorld.x),worldTop=Math.min(marquee.worldStart.y,currentWorld.y),worldRight=Math.max(marquee.worldStart.x,currentWorld.x),worldBottom=Math.max(marquee.worldStart.y,currentWorld.y);Object.assign(marqueeBox.style,{left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});batchSelectedIds.clear();marquee.baseSelection.forEach(id=>batchSelectedIds.add(id));nodes.forEach(node=>{if(node.x<worldRight&&node.x+node.width>worldLeft&&node.y<worldBottom&&node.y+node.height>worldTop)batchSelectedIds.add(node.id)});draw()}
function stopMarqueeAutoPan(){if(marqueeAutoPanFrame)cancelAnimationFrame(marqueeAutoPanFrame);marqueeAutoPanFrame=0}
function startMarqueeAutoPan(){if(marqueeAutoPanFrame)return;let previous=performance.now();const tick=(now:number)=>{if(!marquee?.active){marqueeAutoPanFrame=0;return}const elapsed=Math.min(2,(now-previous)/16.67),edge=82,maxSpeed=13,axisSpeed=(position:number,limit:number)=>position<edge?-Math.min(1,1-position/edge)*maxSpeed:position>limit-edge?Math.min(1,1-(limit-position)/edge)*maxSpeed:0,vx=axisSpeed(marquee.current.x,innerWidth),vy=axisSpeed(marquee.current.y,innerHeight);if(vx||vy){camera.x-=vx*elapsed;camera.y-=vy*elapsed;updateMarqueeSelection()}previous=now;marqueeAutoPanFrame=requestAnimationFrame(tick)};marqueeAutoPanFrame=requestAnimationFrame(tick)}
function refreshCanvasModeHint(){const hint=document.querySelector<HTMLElement>('.dock-create-hint')!,title=hint.querySelector<HTMLElement>('strong')!,detail=hint.querySelector<HTMLElement>('small')!;hint.classList.toggle('multi-mode',multiSelectMode);if(!multiSelectMode){title.textContent='双击画布 · 创建卡片';detail.textContent='菜单中可进入多选模式'}else{title.textContent='点按卡片 · 选择 / 取消';detail.textContent='长按空白框选 · 双击空白退出'}}
function clearMarqueeHold(){window.clearTimeout(marqueeHoldTimer);marqueeHoldTimer=undefined;marqueeHoldPointer=null}
function enterMultiSelectMode(){multiSelectMode=true;marqueeMode=true;document.body.classList.add('marquee-mode');refreshCanvasModeHint();showCanvasModeNotice('已进入多选','点按卡片选择 · 长按空白框选 · 普通滑动移动画布')}
function exitMultiSelectMode(){clearMarqueeHold();stopMarqueeAutoPan();multiSelectMode=false;marqueeMode=false;marquee=null;document.body.classList.remove('marquee-mode');marqueeBox.classList.remove('open');clearBatchSelection();refreshCanvasModeHint();showCanvasModeNotice('已退出多选','已恢复画布移动与节点操作')}
function resetMarqueeRightGesture(){clearMarqueeHold();marqueeContextSuppressedUntil=0}
function cascadeSelectionIds(seed:Set<number>){const result=new Set(seed);let changed=true;while(changed){changed=false;for(const link of links){if(!result.has(link.from)||result.has(link.to))continue;const incoming=links.filter(item=>item.to===link.to);if(!incoming.length||incoming.some(item=>!result.has(item.from)))continue;result.add(link.to);changed=true}}return result}
function deleteBatchSelection(){if(!batchSelectedIds.size)return;if(canvasHasActiveGeneration()){showToast('画布正在生成，任务完成后即可批量删除','warning');return}const targets=cascadeSelectionIds(batchSelectedIds),cascadeCount=targets.size-batchSelectedIds.size;if(!window.confirm(`删除 ${batchSelectedIds.size} 个选中节点${cascadeCount?`，并清理 ${cascadeCount} 个仅依赖它们的下游节点`:''}？`))return;for(let index=nodes.length-1;index>=0;index--)if(targets.has(nodes[index].id))nodes.splice(index,1);for(let index=links.length-1;index>=0;index--)if(targets.has(links[index].from)||targets.has(links[index].to))links.splice(index,1);if(targets.has(selectedId))selectedId=0;clearBatchSelection();updateEditor();scheduleSave();showToast(`已删除 ${targets.size} 个节点`,'success')}
function generateBatchSelection(){const selected=nodes.filter(node=>batchSelectedIds.has(node.id)),candidates=selected.filter(node=>canGenerateNode(node)&&node.status!=='queued'&&node.status!=='running');if(!candidates.length){showToast('选中区域没有可生成的任务节点','warning');return}candidates.forEach(node=>{node.agentAuto=true;node.status='waiting'});const ready=candidates.filter(node=>!links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).some(upstream=>upstream?.kind==='image'&&!upstream.mediaUrl)).length,waiting=candidates.length-ready,skipped=selected.length-candidates.length;scheduleSave();draw();runAgentWorkflow();showToast(`${candidates.length} 个任务已进入依赖队列`,'success',`${ready} 个可立即排队${waiting?` · ${waiting} 个等待上游`:''}${skipped?` · ${skipped} 个不可生成`:''}`)}
batchToolbar.querySelector('[data-batch-generate]')!.addEventListener('click',()=>{generateBatchSelection();exitMultiSelectMode()});batchToolbar.querySelector('[data-batch-delete]')!.addEventListener('click',()=>{deleteBatchSelection();exitMultiSelectMode()});batchToolbar.querySelector('[data-batch-clear]')!.addEventListener('click',exitMultiSelectMode)

document.addEventListener('pointerdown',event=>{const target=event.target as HTMLElement|null,onCanvasSurface=target===canvas||target===nodeLayer;if(!multiSelectMode||event.button!==0||!onCanvasSurface)return;clearMarqueeHold();const start={x:event.clientX,y:event.clientY};marqueeHoldPointer={id:event.pointerId,start,pointerType:event.pointerType};marqueeHoldTimer=window.setTimeout(()=>{if(!marqueeHoldPointer||marqueeHoldPointer.id!==event.pointerId||!multiSelectMode)return;const touch=marqueeHoldPointer.pointerType==='touch';pointer.down=false;pointer.draggingNode=null;canvas.classList.remove('dragging');marquee={pointerId:event.pointerId,start,worldStart:world(start),current:{...start},active:true,baseSelection:new Set(batchSelectedIds)};selectedId=0;updateEditor();marqueeBox.classList.add('open');updateMarqueeSelection();startMarqueeAutoPan();if(touch){if(navigator.vibrate)navigator.vibrate(18);showCanvasModeNotice('框选已开启','保持按住并移动，可继续扩大选择范围')}clearMarqueeHold()},360)},true)
document.addEventListener('pointermove',event=>{if(marqueeHoldPointer?.id===event.pointerId&&Math.hypot(event.clientX-marqueeHoldPointer.start.x,event.clientY-marqueeHoldPointer.start.y)>8)clearMarqueeHold();if(!marquee||event.pointerId!==marquee.pointerId)return;marquee.current={x:event.clientX,y:event.clientY};if(!marquee.active)return;event.preventDefault();event.stopImmediatePropagation();updateMarqueeSelection()},true)
document.addEventListener('pointerup',event=>{if(marqueeHoldPointer?.id===event.pointerId)clearMarqueeHold();if(!marquee||event.pointerId!==marquee.pointerId)return;const active=marquee.active;stopMarqueeAutoPan();marquee=null;marqueeBox.classList.remove('open');if(active){event.preventDefault();event.stopImmediatePropagation();marqueeContextSuppressedUntil=performance.now()+650;selectedId=0;updateEditor();refreshBatchSelection()}},true)
document.addEventListener('pointercancel',event=>{if(marqueeHoldPointer?.id===event.pointerId)clearMarqueeHold();if(!marquee||event.pointerId!==marquee.pointerId)return;stopMarqueeAutoPan();marquee=null;marqueeBox.classList.remove('open')},true)
document.addEventListener('contextmenu',event=>{if(!multiSelectMode&&performance.now()>=marqueeContextSuppressedUntil)return;event.preventDefault();event.stopImmediatePropagation()},true)
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&multiSelectMode)exitMultiSelectMode()})

canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; if (cameraFrame !== null) { cancelAnimationFrame(cameraFrame); cameraFrame = null; zoomTarget = camera.zoom } pointer.down = true; pointer.x = e.clientX; pointer.y = e.clientY; const port = hitPort(e.clientX, e.clientY); if (port?.side==='right') { connectionSnap = null; connecting = { nodeId: port.node.id, side:'right', pointer: { x: e.clientX, y: e.clientY } }; selectedId = 0; pointer.draggingNode = null; updateEditor() } else { const node = hitNode(e.clientX, e.clientY); pointer.draggingNode = node && node.status !== 'queued' && node.status !== 'running' ? node.id : null; if (node) selectedId = node.id; else selectedId = 0; updateEditor() } canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); draw() })
canvas.addEventListener('pointermove', e => { if (!pointer.down) return; setSaveState('editing', '编辑中…'); if (connecting) { updateConnectionPointer(e.clientX, e.clientY); draw(); return } const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (pointer.draggingNode) { const node = nodes.find(n => n.id === pointer.draggingNode)!; node.x += dx / camera.zoom; node.y += dy / camera.zoom } else { camera.x += dx; camera.y += dy } pointer.x = e.clientX; pointer.y = e.clientY; draw() })
canvas.addEventListener('pointerup', e => { if (connecting) { const snappedNode = connectionSnap ? nodes.find(node => node.id === connectionSnap!.nodeId) : undefined, target = snappedNode ? { node: snappedNode, side: connectionSnap!.side } : hitPort(e.clientX, e.clientY, connectionSnapRadius, connecting.nodeId); if (target) {const next=directedLink(connecting.nodeId,connecting.side,target.node.id,target.side);if(next&&!links.some(link=>link.from===next.from&&link.to===next.to))links.push(next)} connecting = null; connectionSnap = null } scheduleSave(); pointer.down = false; pointer.draggingNode = null; canvas.classList.remove('dragging'); draw() })
canvas.addEventListener('wheel', e => { e.preventDefault(); closeQuickNodeMenu(); smoothZoom(zoomTarget * Math.exp(-e.deltaY * .001), { x: e.clientX, y: e.clientY }) }, { passive: false })
nodeLayer.addEventListener('wheel', e => {
  const target = e.target as HTMLElement | null
  if (target?.closest('textarea,input,select,[contenteditable="true"],.node-copy,.image-original-prompt p')) return
  e.preventDefault(); e.stopPropagation(); closeQuickNodeMenu(); smoothZoom(zoomTarget * Math.exp(-e.deltaY * .001), { x: e.clientX, y: e.clientY })
}, { passive: false })
const linkHoverHint = document.querySelector<HTMLElement>('#link-hover-hint')!
const touchLinkAction=document.querySelector<HTMLButtonElement>('#touch-link-action')!
function closeTouchLinkAction(){touchSelectedLinkIndex=-1;touchLinkGesture=null;touchLinkAction.classList.remove('open','locked');draw()}
function openTouchLinkAction(index:number,x:number,y:number){if(index<0||!links[index])return closeTouchLinkAction();touchSelectedLinkIndex=index;const locked=canvasHasActiveGeneration();touchLinkAction.classList.toggle('locked',locked);touchLinkAction.disabled=locked;touchLinkAction.querySelector('span')!.textContent=locked?'生成中不可删除':'删除连线';touchLinkAction.querySelector('small')!.textContent=locked?'任务完成后即可操作':'';touchLinkAction.classList.add('open');touchLinkAction.style.left=`${Math.max(10,Math.min(innerWidth-touchLinkAction.offsetWidth-10,x+12))}px`;touchLinkAction.style.top=`${Math.max(68,Math.min(innerHeight-touchLinkAction.offsetHeight-12,y-18))}px`;draw()}
document.addEventListener('pointerdown',event=>{if(touchSelectedLinkIndex>=0&&!touchLinkAction.contains(event.target as Node))closeTouchLinkAction()},true)
canvas.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||event.button!==0||multiSelectMode)return;const index=hitLink(event.clientX,event.clientY,18);touchLinkGesture={pointerId:event.pointerId,start:{x:event.clientX,y:event.clientY},index,moved:false}},true)
canvas.addEventListener('pointermove',event=>{if(!touchLinkGesture||touchLinkGesture.pointerId!==event.pointerId)return;if(Math.hypot(event.clientX-touchLinkGesture.start.x,event.clientY-touchLinkGesture.start.y)>9)touchLinkGesture.moved=true},true)
canvas.addEventListener('pointerup',event=>{if(!touchLinkGesture||touchLinkGesture.pointerId!==event.pointerId)return;const gesture=touchLinkGesture;touchLinkGesture=null;if(gesture.moved)return;if(gesture.index>=0){openTouchLinkAction(gesture.index,event.clientX,event.clientY);if(navigator.vibrate)navigator.vibrate(10)}else closeTouchLinkAction()},true)
canvas.addEventListener('pointercancel',()=>{touchLinkGesture=null},true)
touchLinkAction.addEventListener('click',()=>{if(touchSelectedLinkIndex<0||!links[touchSelectedLinkIndex])return closeTouchLinkAction();if(canvasHasActiveGeneration()){showToast('画布正在生成，任务完成后即可删除连线','warning');return}links.splice(touchSelectedLinkIndex,1);if(navigator.vibrate)navigator.vibrate(18);closeTouchLinkAction();scheduleSave();showToast('连线已删除','success')})
canvas.addEventListener('pointermove', event => { if (pointer.down || connecting) return; const index = hitLink(event.clientX, event.clientY); if (index !== hoveredLinkIndex) { hoveredLinkIndex = index; draw() } linkHoverHint.classList.toggle('open', index >= 0); if (index >= 0) { const generating = canvasHasActiveGeneration(); linkHoverHint.classList.toggle('locked', generating); linkHoverHint.textContent = generating ? '画布生成中 · 连线已锁定' : '右键 · 删除连线'; linkHoverHint.style.left = `${event.clientX + 14}px`; linkHoverHint.style.top = `${event.clientY + 14}px`; canvas.style.cursor = 'pointer' } else canvas.style.removeProperty('cursor') })
canvas.addEventListener('pointerleave', () => { if (hoveredLinkIndex >= 0) { hoveredLinkIndex = -1; draw() } linkHoverHint.classList.remove('open'); canvas.style.removeProperty('cursor') })
canvas.addEventListener('contextmenu', event => { event.preventDefault();if(performance.now()<marqueeContextSuppressedUntil)return; const index = hitLink(event.clientX, event.clientY); if (index < 0) return; if (canvasHasActiveGeneration()) { showToast('画布正在生成，任务完成后即可删除连线', 'warning'); return } links.splice(index, 1); hoveredLinkIndex = -1; linkHoverHint.classList.remove('open'); scheduleSave(); draw() })
document.querySelector('#reset')!.addEventListener('click', fitCanvas)
document.querySelector('#mobile-fit-canvas')!.addEventListener('click',fitCanvas)
zoomSlider.addEventListener('input', () => { zoomTarget = Number(zoomSlider.value) / 100; setZoom(zoomTarget, { x: innerWidth / 2, y: innerHeight / 2 }) })
document.querySelector('#zoom-in')!.addEventListener('click', () => smoothZoom(zoomTarget * 1.15, { x: innerWidth / 2, y: innerHeight / 2 }))
document.querySelector('#zoom-out')!.addEventListener('click', () => smoothZoom(zoomTarget / 1.15, { x: innerWidth / 2, y: innerHeight / 2 }))
document.querySelector('#quick-create')!.addEventListener('click', () => addNode('image'))
generateButton.addEventListener('click', () => void generate())
document.querySelector('#delete-node')!.addEventListener('click', deleteSelectedNode)
titleInput.addEventListener('input', () => { const node = selectedNode(); if (!node) return; node.title = titleInput.value; scheduleSave(); draw() })
promptInput.addEventListener('input', () => { const node = selectedNode(); if (!node) return; node.body = promptInput.value; scheduleSave(); draw() })
modelInput.addEventListener('change', () => { const node = selectedNode(); if (!node) return; node.model = modelInput.value; scheduleSave(); draw() })
document.querySelectorAll<HTMLElement>('[data-add]').forEach(button => button.addEventListener('click', () => addNode(button.dataset.add as NodeKind)))
const quickNodeMenu = document.querySelector<HTMLElement>('#quick-node-menu')!
let quickNodePosition: Point | null = null
function closeQuickNodeMenu() { quickNodeMenu.classList.remove('open'); quickNodePosition = null }
canvas.addEventListener('dblclick', event => {
  if (event.button !== 0 || connecting || hitNode(event.clientX, event.clientY)) return
  event.preventDefault()
  if(multiSelectMode){exitMultiSelectMode();return}
  quickNodePosition = world({ x: event.clientX, y: event.clientY })
  quickNodeMenu.style.left = `${Math.max(12, Math.min(event.clientX + 12, innerWidth - 310))}px`
  quickNodeMenu.style.top = `${Math.max(12, Math.min(event.clientY + 12, innerHeight - 410))}px`
  quickNodeMenu.classList.remove('open')
  requestAnimationFrame(() => { quickNodeMenu.classList.add('open'); quickNodeMenu.querySelector<HTMLButtonElement>('[data-quick-add]')?.focus() })
})
quickNodeMenu.querySelectorAll<HTMLButtonElement>('[data-quick-add]').forEach(button => button.addEventListener('click', event => {
  event.stopPropagation()
  if (quickNodePosition) addNode(button.dataset.quickAdd as NodeKind, quickNodePosition)
  closeQuickNodeMenu()
}))
quickNodeMenu.querySelector<HTMLButtonElement>('[data-quick-upload]')!.addEventListener('click', event => {
  event.stopPropagation()
  contextUploadPosition = quickNodePosition
  closeQuickNodeMenu()
  assetUpload.click()
})
quickNodeMenu.querySelector<HTMLButtonElement>('[data-quick-multi]')!.addEventListener('click',event=>{event.stopPropagation();closeQuickNodeMenu();enterMultiSelectMode()})
const appearanceButton = document.querySelector<HTMLButtonElement>('#dock-appearance')!
let themeTransitioning = false
function refreshAppearanceButton() { appearanceButton.disabled = themeTransitioning || pendingMediaLoads.size > 0; appearanceButton.title = pendingMediaLoads.size ? `等待 ${pendingMediaLoads.size} 个图片资源加载完成` : '切换画布外观' }
appearanceButton.addEventListener('click',()=>{
  if(themeTransitioning||appearanceButton.disabled)return
  themeTransitioning=true;refreshAppearanceButton();document.body.classList.add('theme-click-fade')
  window.setTimeout(()=>{colorTheme=colorTheme==='dark'?'light':'dark';document.body.dataset.theme=colorTheme;localStorage.setItem('flow-theme',colorTheme);repaintAllMedia();paint();document.body.classList.add('theme-click-return');document.body.classList.remove('theme-click-fade')},90)
  window.setTimeout(()=>{document.body.classList.remove('theme-click-return');themeTransitioning=false;refreshAppearanceButton()},260)
})
type PromptAgentStep = { title?:string; kind:'image'|'video'; prompt:string; referenceIndexes?:number[]; dependsOn?:number[]; duration?:number; aspectRatio?:string; stage?:'character'|'prop'|'scene'|'storyboard'|'video'; autoGenerate?:boolean }
type PromptAgentResult = { model:string; kind:'image'|'video'; subject:string; scene:string; composition:string; lighting:string; style:string; motion:string; negativePrompt:string; finalPrompt:string; action?:'update_current'|'create_child'|'create_new'; targetType?:'image'|'video'; summary?:string; shouldGenerate?:boolean; layout?:'workflow'|'storyboard'|'comic-workflow'; steps?:PromptAgentStep[] }
type ComicCharacterForm={name:string;description:string;imagePrompt?:string}
type ComicShot = { number:number; title:string; duration:number; storyBeat?:string; action?:string; scene:string; sceneId?:string; scenePrompt?:string; characterIndexes?:number[]; characterForms?:Array<{characterIndex:number;form:string}>; propIndexes?:number[]; dialogue:string; frames?:Array<{title:string;imagePrompt:string}>; imagePrompt:string; videoPrompt:string; referenceIndexes:number[]; transition?:string; continuity?:string }
type ComicPlan = { title:string; logline:string; tone:string; duration:string; aspectRatio:string; characters:Array<{name:string;description:string;voiceProfile?:string;visualAsset?:boolean;imagePrompt?:string;forms?:ComicCharacterForm[]}>; props?:Array<{name:string;description:string;imagePrompt?:string}>; outline:Array<{act:string;content:string}>; shots:ComicShot[]; changeSummary?:string; model?:string }
const promptAgentTrigger=document.querySelector<HTMLButtonElement>('#prompt-agent-trigger')!,promptAgentPanel=document.createElement('section')
promptAgentPanel.className='prompt-agent-panel agent-capsule';promptAgentPanel.innerHTML=`<aside class="agent-selection-hint" aria-live="polite"><i>◇</i><span>点击卡片选择素材</span><em></em><kbd>右击</kbd><small>退出</small></aside><section class="agent-context"><div data-agent-context-list></div></section><button class="agent-comic-entry" type="button" aria-label="漫剧策划"><span>◫</span><b>漫剧</b></button><label class="agent-goal"><textarea rows="1" placeholder="告诉我你想创造什么…" aria-label="创作需求"></textarea></label><button class="agent-submit" type="button" aria-label="开始创作"><span>✦</span><b>开始创作</b></button><output class="agent-status" hidden></output><article hidden><div class="agent-result-meta"><span>执行结果</span><small></small></div><strong data-agent-summary></strong><details><summary>查看提示词</summary><p data-agent-prompt></p></details><footer><button type="button" data-agent-undo hidden>撤销</button><button type="button" data-agent-copy>复制</button><button type="button" data-agent-locate>定位</button></footer></article>`;document.body.append(promptAgentPanel)
const comicStudio=document.createElement('section');comicStudio.className='comic-studio comic-chat-studio';comicStudio.innerHTML=`<header><div><small>VIORA STORY</small><h2>和灵感一起写漫剧</h2></div><nav><div class="comic-label-control"><button type="button" data-comic-label-picker aria-label="关联标签"><span>◇</span><b>关联标签</b></button><div class="comic-label-menu" data-comic-label-menu></div></div><button type="button" data-comic-new aria-label="新会话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>新会话</span></button><button type="button" data-comic-close aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25"/></svg></button></nav></header><aside class="comic-linked-label" data-comic-linked-label hidden></aside><div class="comic-conversation" data-comic-conversation><div class="comic-message assistant comic-welcome"><i>✦</i><div><b>说说你想做的故事</b><p>一句想法就够了。时长、画幅、风格都可以直接说，我会先整理剧情和分镜；之后你可以像聊天一样继续修改。</p></div></div><section class="comic-plan" hidden><div class="comic-plan-head"><div><small data-comic-meta></small><h3 data-comic-title></h3><p data-comic-logline></p></div></div><div class="comic-plan-scroll"><article><h4>人物与世界</h4><div data-comic-characters></div></article><article><h4>剧情大纲</h4><ol data-comic-outline></ol></article><article><h4>制作分镜</h4><div data-comic-shots></div></article></div><div class="comic-plan-actions"><button type="button" data-comic-label><span>保存为标签</span></button><button type="button" data-comic-label-copy hidden><span>另存为标签</span></button><button type="button" data-comic-canvas><span>铺到画布</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div></section></div><footer class="comic-composer"><textarea data-comic-message rows="1" placeholder="描述故事，或继续告诉我怎么修改…"></textarea><button type="button" data-comic-send aria-label="发送"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></footer><output data-comic-status></output>`;document.body.append(comicStudio)
const promptAgentModelSelect=document.createElement('select');promptAgentModelSelect.hidden=true;promptAgentModelSelect.innerHTML='<option value="gpt-5.5" selected>gpt-5.5</option>';promptAgentPanel.append(promptAgentModelSelect)
const promptAgentEffects=document.createElement('canvas'),promptAgentEffectsFront=document.createElement('canvas');promptAgentEffects.className='agent-capsule-effects';promptAgentEffectsFront.className='agent-capsule-effects front';document.body.append(promptAgentEffects,promptAgentEffectsFront)
const promptAgentRibbonBack=document.createElement('div'),promptAgentRibbonFront=document.createElement('div');promptAgentRibbonBack.className='agent-capsule-ribbon back';promptAgentRibbonFront.className='agent-capsule-ribbon front';promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-back" x1="0" y1="0" x2="720" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="#80ddd4" stop-opacity="0"/><stop offset=".28" stop-color="#74d8d0" stop-opacity=".5"/><stop offset=".68" stop-color="#829ee0" stop-opacity=".38"/><stop offset="1" stop-color="#829ee0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-blur"><feGaussianBlur stdDeviation="1.7"/></filter></defs><path d="M-42 118C92 12 188 151 318 73C431 5 527 150 762 46" fill="none" stroke="url(#agent-ribbon-back)" stroke-width="15" stroke-linecap="round" filter="url(#agent-ribbon-blur)"/></svg>`;promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-front" x1="0" y1="180" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#819de2" stop-opacity="0"/><stop offset=".32" stop-color="#8ba9e8" stop-opacity=".36"/><stop offset=".64" stop-color="#8de7da" stop-opacity=".55"/><stop offset="1" stop-color="#8de7da" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-blur"><feGaussianBlur stdDeviation="1.25"/></filter></defs><path d="M-35 42C123 151 226 23 356 111C484 198 575 22 755 126" fill="none" stroke="url(#agent-ribbon-front)" stroke-width="9" stroke-linecap="round" filter="url(#agent-ribbon-front-blur)"/></svg>`;document.body.append(promptAgentRibbonBack,promptAgentRibbonFront)
promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-back" x1="0" y1="20" x2="720" y2="160" gradientUnits="userSpaceOnUse"><stop stop-color="#75ddd3" stop-opacity="0"/><stop offset=".2" stop-color="#72d9d0" stop-opacity=".48"/><stop offset=".53" stop-color="#94e7dd" stop-opacity=".34"/><stop offset=".8" stop-color="#809de0" stop-opacity=".4"/><stop offset="1" stop-color="#809de0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-surface-soft"><feGaussianBlur stdDeviation="1.1"/></filter></defs><path fill="url(#agent-ribbon-surface-back)" filter="url(#agent-ribbon-surface-soft)" d="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"><animate attributeName="d" dur="7.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.34;.68;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z;M-45 126C82 34 173 133 304 59C430-12 557 158 765 55L765 91C550 177 453 38 329 91C196 164 65 65-45 153Z;M-45 102C61 8 194 165 326 82C451 3 535 129 765 35L765 63C570 155 438 17 314 116C176 197 83 39-45 134Z;M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"/></path></svg>`
promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-front" x1="0" y1="170" x2="720" y2="10" gradientUnits="userSpaceOnUse"><stop stop-color="#829fe3" stop-opacity="0"/><stop offset=".24" stop-color="#8ca8e7" stop-opacity=".36"/><stop offset=".58" stop-color="#9be9df" stop-opacity=".5"/><stop offset=".84" stop-color="#78dcd2" stop-opacity=".42"/><stop offset="1" stop-color="#78dcd2" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-soft"><feGaussianBlur stdDeviation=".8"/></filter></defs><path fill="url(#agent-ribbon-surface-front)" filter="url(#agent-ribbon-front-soft)" d="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"><animate attributeName="d" dur="9.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.38;.72;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z;M-40 48C125 159 207 7 341 92C469 174 590 31 760 132L760 157C585 68 471 198 360 119C224 30 103 187-40 78Z;M-40 24C98 127 231 32 366 116C495 196 563 5 760 105L760 134C563 39 497 220 337 140C201 62 132 154-40 51Z;M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"/></path></svg>`
promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-back" x1="0" y1="20" x2="720" y2="130" gradientUnits="userSpaceOnUse"><stop stop-color="#72d8cf" stop-opacity="0"/><stop offset=".18" stop-color="#7cddd4" stop-opacity=".34"/><stop offset=".46" stop-color="#b5f3e9" stop-opacity=".42"/><stop offset=".72" stop-color="#91a9e7" stop-opacity=".3"/><stop offset="1" stop-color="#849fe2" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-shine" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".34"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#557fc8" stop-opacity=".12"/></linearGradient><filter id="agent-silk-soft"><feGaussianBlur stdDeviation=".65"/></filter></defs><path fill="url(#agent-silk-back)" filter="url(#agent-silk-soft)" d="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"><animate attributeName="d" dur="10.5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".42 0 .58 1;.42 0 .58 1" values="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z;M-35 109C78 26 205 38 353 33C508 28 635 25 755 99L755 120C628 51 511 55 358 61C203 67 81 48-35 131Z;M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"/></path><path fill="url(#agent-silk-shine)" opacity=".42" d="M-20 104C101 31 220 42 357 45C505 48 626 30 741 96L741 101C625 41 501 56 357 53C215 50 101 40-20 114Z"/></svg>`
promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-front-left" x1="0" y1="0" x2="240" y2="120" gradientUnits="userSpaceOnUse"><stop stop-color="#7edfd5" stop-opacity="0"/><stop offset=".48" stop-color="#a4eee4" stop-opacity=".58"/><stop offset="1" stop-color="#8ca9e8" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-front-right" x1="470" y1="30" x2="720" y2="150" gradientUnits="userSpaceOnUse"><stop stop-color="#8ca7e7" stop-opacity="0"/><stop offset=".48" stop-color="#9feadf" stop-opacity=".52"/><stop offset="1" stop-color="#79dcd2" stop-opacity="0"/></linearGradient><filter id="agent-silk-front-soft"><feGaussianBlur stdDeviation=".45"/></filter></defs><path fill="url(#agent-silk-front-left)" filter="url(#agent-silk-front-soft)" d="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"><animate attributeName="d" dur="9.8s" repeatCount="indefinite" values="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z;M-25 116C51 142 119 140 220 127L231 148C126 163 48 158-25 132Z;M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"/></path><path fill="url(#agent-silk-front-right)" filter="url(#agent-silk-front-soft)" d="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"><animate attributeName="d" dur="11.2s" repeatCount="indefinite" values="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z;M476 46C579 29 665 54 755 106L755 126C654 70 575 56 470 67Z;M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"/></path></svg>`
const physicalAgentRibbon=(id:string,front:boolean)=>`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="${id}-fabric" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#496f78"/><stop offset=".12" stop-color="#759ca4"/><stop offset=".3" stop-color="#b9d4d2"/><stop offset=".47" stop-color="#739ca2"/><stop offset=".7" stop-color="#9bbbc0"/><stop offset=".9" stop-color="#526f82"/><stop offset="1" stop-color="#354c60"/></linearGradient><linearGradient id="${id}-fade" x1="0" y1="0" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".13" stop-color="#fff" stop-opacity="1"/><stop offset=".87" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${id}-end-fade"><rect width="720" height="180" fill="url(#${id}-fade)"/></mask>${front?`<clipPath id="${id}-front"><rect x="0" y="0" width="178" height="180"/><rect x="548" y="0" width="172" height="180"/></clipPath>`:''}</defs><g mask="url(#${id}-end-fade)" ${front?`clip-path="url(#${id}-front)"`:''}><path class="physical-ribbon-body" fill="url(#${id}-fabric)" d="M-42 112C74 18 190 157 326 68C450-13 557 151 762 48L762 80C564 178 455 20 333 101C195 190 82 55-42 147Z"/><path class="physical-ribbon-fold light" d="M-30 114C86 33 194 153 327 77C451 6 556 155 750 62"/><path class="physical-ribbon-fold shade" d="M-28 136C91 67 196 176 332 92C458 14 560 168 748 73"/></g></svg>`
promptAgentRibbonBack.innerHTML=physicalAgentRibbon('physical-agent-back',false);promptAgentRibbonFront.innerHTML=physicalAgentRibbon('physical-agent-front',true)
const promptAgentBurst=document.createElement('div');promptAgentBurst.className='agent-particle-burst';promptAgentBurst.innerHTML=Array.from({length:28},()=>'<i></i>').join('');promptAgentTrigger.append(promptAgentBurst)
promptAgentBurst.querySelectorAll<HTMLElement>('i').forEach((particle,index)=>{const angle=index*2.399+(index%4)*.19,distance=34+(index*17)%86;particle.style.setProperty('--hx',`${Math.cos(angle)*distance}px`);particle.style.setProperty('--hy',`${Math.sin(angle)*distance*.72}px`);particle.style.setProperty('--delay',`${-(index%14)*61}ms`);particle.style.setProperty('--duration',`${720+(index%7)*34}ms`)})
let promptAgentKind:'image'|'video'='image',promptAgentComplexity:'simple'|'detailed'='simple',promptAgentResult:PromptAgentResult|null=null,promptAgentContextNodes:FlowNode[]=[],promptAgentAppliedNodeId=0,promptAgentUndo:(()=>void)|null=null
let promptAgentEffectFrame:number|null=null
let promptAgentRequestController:AbortController|null=null,promptAgentRequestVersion=0,promptAgentFormTimer=0
const promptAgentEffectParticles=Array.from({length:46},(_,index)=>({offset:(index*.754877666)%1,speed:.026+(index%9)*.004,size:.8+(index%6)*.32,ribbon:index%2,phase:index*1.37,lag:10+(index%8)*3}))
function paintPromptAgentEffects(now:number){if(!promptAgentPanel.classList.contains('open')){promptAgentEffects.hidden=true;promptAgentEffectsFront.hidden=true;promptAgentEffectFrame=null;return}promptAgentEffects.hidden=false;promptAgentEffectsFront.hidden=false;const rect=promptAgentPanel.getBoundingClientRect(),padX=46,padY=42,width=Math.ceil(rect.width+padX*2),height=Math.ceil(rect.height+padY*2),ratio=Math.min(2,devicePixelRatio||1),canvases=[promptAgentEffects,promptAgentEffectsFront];for(const canvas of canvases){canvas.style.left=`${rect.left-padX}px`;canvas.style.top=`${rect.top-padY}px`;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;if(canvas.width!==width*ratio||canvas.height!==height*ratio){canvas.width=width*ratio;canvas.height=height*ratio}}const contexts=canvases.map(canvas=>canvas.getContext('2d')!);for(const context of contexts){context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height)}const time=now/1000,center=height/2
  const ribbonY=(progress:number,ribbon:number)=>center+(ribbon?1:-1)*(rect.height/2+8)+Math.sin(progress*(ribbon?7.1:6.35)+time*(ribbon?.7:.86)+(ribbon?1.8:.25))*4.8+Math.sin(progress*(ribbon?15.2:12.7)-time*.42+ribbon)*1.9
  const drawRibbon=(context:CanvasRenderingContext2D,ribbon:number,start=0,end=1,alpha=.5)=>{const thickness=ribbon?5.5:7,from=12+start*(width-24),to=12+end*(width-24),gradient=context.createLinearGradient(from,0,to,0);gradient.addColorStop(0,'rgba(95,214,207,0)');gradient.addColorStop(.18,ribbon?'rgba(123,151,236,.72)':'rgba(86,225,212,.78)');gradient.addColorStop(.78,ribbon?'rgba(145,167,241,.62)':'rgba(139,240,226,.68)');gradient.addColorStop(1,'rgba(108,220,213,0)');context.beginPath();for(let x=from;x<=to;x+=4){const y=ribbonY(x/width,ribbon);if(x===from)context.moveTo(x,y-thickness/2);else context.lineTo(x,y-thickness/2)}for(let x=to;x>=from;x-=4)context.lineTo(x,ribbonY(x/width,ribbon)+thickness/2);context.closePath();context.fillStyle=gradient;context.globalAlpha=alpha;context.shadowColor=ribbon?'rgba(116,145,235,.5)':'rgba(80,222,211,.62)';context.shadowBlur=11;context.fill()}
  drawRibbon(contexts[0],0,0,1,.46);drawRibbon(contexts[0],1,0,1,.4);const frontCenter0=(time*.075)%1,frontCenter1=(.55+time*.061)%1;for(const [ribbon,frontCenter] of [[0,frontCenter0],[1,frontCenter1]] as const){const start=frontCenter-.15,end=frontCenter+.15;if(start<0){drawRibbon(contexts[1],ribbon,start+1,1,.68);drawRibbon(contexts[1],ribbon,0,end,.68)}else if(end>1){drawRibbon(contexts[1],ribbon,start,1,.68);drawRibbon(contexts[1],ribbon,0,end-1,.68)}else drawRibbon(contexts[1],ribbon,start,end,.68)}
  for(const particle of promptAgentEffectParticles){const life=(particle.offset+time*particle.speed)%1,progress=Math.max(.015,life-particle.lag/width),frontCenter=particle.ribbon?frontCenter1:frontCenter0,distance=Math.min(Math.abs(progress-frontCenter),1-Math.abs(progress-frontCenter)),context=contexts[distance<.17?1:0],x=12+progress*(width-24),trailFade=Math.sin(life*Math.PI),outward=particle.ribbon?1:-1,scatter=outward*(5+Math.sin(life*17+particle.phase)*4);context.beginPath();context.arc(x,ribbonY(progress,particle.ribbon)+scatter,particle.size,0,Math.PI*2);context.fillStyle=particle.ribbon?'rgba(145,169,246,.9)':'rgba(137,244,231,.94)';context.globalAlpha=trailFade*trailFade*.72;context.shadowColor=particle.ribbon?'#91a8f2':'#8cf1e5';context.shadowBlur=7;context.fill()}for(const context of contexts)context.globalAlpha=1;promptAgentEffectFrame=requestAnimationFrame(paintPromptAgentEffects)}
function positionPromptAgentRibbons(){const rect=promptAgentPanel.getBoundingClientRect();for(const ribbon of [promptAgentRibbonBack,promptAgentRibbonFront]){ribbon.style.left=`${rect.left-54}px`;ribbon.style.top=`${rect.top-38}px`;ribbon.style.width=`${rect.width+108}px`;ribbon.style.height=`${rect.height+76}px`}}
function startPromptAgentEffects(){promptAgentEffects.hidden=true;promptAgentEffectsFront.hidden=true;promptAgentRibbonBack.classList.remove('visible');promptAgentRibbonFront.classList.remove('visible')}
function closePromptAgent(){window.clearTimeout(promptAgentFormTimer);promptAgentFormTimer=0;promptAgentRequestController?.abort();promptAgentRequestController=null;promptAgentRequestVersion++;promptAgentPanel.querySelector('.agent-submit')?.classList.remove('is-running');promptAgentPanel.classList.remove('open','forming');promptAgentTrigger.classList.remove('active');promptAgentSelecting=false;promptAgentContextSelection.clear();promptAgentContextNodes=[];if(promptAgentEffectFrame!==null)cancelAnimationFrame(promptAgentEffectFrame);promptAgentEffectFrame=null;promptAgentEffects.hidden=true;promptAgentEffectsFront.hidden=true;promptAgentRibbonBack.classList.remove('visible');promptAgentRibbonFront.classList.remove('visible');draw()}
function dispersePromptAgent(){if(!promptAgentPanel.classList.contains('open')||promptAgentPanel.classList.contains('gathering'))return;const panelRect=promptAgentPanel.getBoundingClientRect(),ghost=promptAgentPanel.cloneNode(true) as HTMLElement;ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));ghost.classList.add('agent-disperse-ghost','gathering');Object.assign(ghost.style,{left:`${panelRect.left}px`,top:`${panelRect.top}px`,right:'auto',bottom:'auto',width:`${panelRect.width}px`,height:`${panelRect.height}px`});document.body.append(ghost);const target={x:panelRect.width/2,y:panelRect.height/2},materials=[...ghost.querySelectorAll<HTMLElement>('[data-agent-context-node]')];materials.forEach((material,index)=>{const rect=material.getBoundingClientRect();material.style.setProperty('--gather-x',`${target.x-(rect.left-panelRect.left+rect.width/2)}px`);material.style.setProperty('--gather-y',`${target.y-(rect.top-panelRect.top+rect.height/2)}px`);material.style.setProperty('--gather-delay',`${index*18}ms`);material.classList.add('is-gathering')});closePromptAgent();window.setTimeout(()=>{const field=document.createElement('div');field.className='agent-disperse-field';field.style.left=`${panelRect.left}px`;field.style.top=`${panelRect.top}px`;field.style.width=`${panelRect.width}px`;field.style.height=`${panelRect.height}px`;field.innerHTML=Array.from({length:82},(_,index)=>{const column=(index*37)%100,row=(index*61)%100,angle=index*2.399963,distance=28+(index%11)*5,dx=Math.cos(angle)*distance,dy=Math.sin(angle)*distance*.72,size=2+(index%4);return `<i style="left:${column}%;top:${row}%;width:${size}px;height:${size}px;--scatter-x:${dx}px;--scatter-y:${dy}px;--particle-delay:${(index%9)*8}ms"></i>`}).join('');document.body.append(field);ghost.classList.add('dispersing');requestAnimationFrame(()=>field.classList.add('active'));window.setTimeout(()=>{field.remove();ghost.remove()},680)},Math.max(190,materials.length*18+150))}
function dispersePromptAgentDirect(){if(!promptAgentPanel.classList.contains('open'))return;const panelRect=promptAgentPanel.getBoundingClientRect();closePromptAgent();const field=document.createElement('div');field.className='agent-disperse-field';field.style.left=`${panelRect.left}px`;field.style.top=`${panelRect.top}px`;field.style.width=`${panelRect.width}px`;field.style.height=`${panelRect.height}px`;field.innerHTML=Array.from({length:82},(_,index)=>{const column=(index*37)%100,row=(index*61)%100,angle=index*2.399963,distance=32+(index%11)*6,dx=Math.cos(angle)*distance,dy=Math.sin(angle)*distance*.72,size=2+(index%4);return `<i style="left:${column}%;top:${row}%;width:${size}px;height:${size}px;--scatter-x:${dx}px;--scatter-y:${dy}px;--particle-delay:${(index%9)*8}ms"></i>`}).join('');document.body.append(field);requestAnimationFrame(()=>field.classList.add('active'));window.setTimeout(()=>field.remove(),680)}
function playAgentMeteor(){const node=nodes.find(item=>item.id===promptAgentAppliedNodeId);if(!node)return;const panel=promptAgentPanel.getBoundingClientRect(),start={x:panel.left+panel.width*.25,y:panel.top+panel.height*.45},end={x:innerWidth/2+camera.x+(node.x+node.width/2)*camera.zoom,y:innerHeight/2+camera.y+(node.y+node.height/2)*camera.zoom},dx=end.x-start.x,dy=end.y-start.y,distance=Math.hypot(dx,dy),meteor=document.createElement('div');meteor.className='agent-meteor';meteor.style.left=`${start.x}px`;meteor.style.top=`${start.y}px`;meteor.style.width=`${distance}px`;meteor.style.rotate=`${Math.atan2(dy,dx)}rad`;meteor.style.setProperty('--distance',`${distance}px`);meteor.innerHTML=Array.from({length:18},(_,index)=>`<i style="--delay:${index*13}ms;--lane:${(index%5-2)*3}px"></i>`).join('');document.body.append(meteor);const element=nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);element?.classList.add('agent-materializing');window.setTimeout(()=>{meteor.remove();element?.classList.remove('agent-materializing')},900)}
function positionPromptAgentParticles(){promptAgentBurst.style.left='50%';promptAgentBurst.style.top='50%'}
function positionPromptAgentCapsule(){const trigger=promptAgentTrigger.getBoundingClientRect(),width=promptAgentPanel.offsetWidth||330,left=Math.max(10,Math.min(innerWidth-width-10,trigger.left+trigger.width/2-width/2));promptAgentPanel.style.right='auto';promptAgentPanel.style.left=`${left}px`;promptAgentPanel.style.bottom=`${Math.max(82,innerHeight-trigger.top+12)}px`}
function stopPromptAgentHover(){promptAgentBurst.classList.remove('hover-active')}
function playPromptAgentHover(){positionPromptAgentParticles();promptAgentBurst.classList.add('hover-active')}
function collectPromptAgentContext(){const selected=nodes.find(node=>node.id===selectedId),result:FlowNode[]=[],seen=new Set<number>(),visit=(node:FlowNode)=>{if(seen.has(node.id)||result.length>=8)return;seen.add(node.id);result.push(node);links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).filter((item):item is FlowNode=>Boolean(item)).sort((a,b)=>a.y-b.y||a.x-b.x||a.id-b.id).forEach(visit)};for(const id of promptAgentContextSelection){const node=nodes.find(item=>item.id===id);if(node)visit(node)}if(selected)visit(selected);return result}
function selectedPromptAgentNodes(){return [...promptAgentContextSelection].map(id=>nodes.find(node=>node.id===id)).filter((node):node is FlowNode=>Boolean(node))}
function renderPromptAgentContext(reset=false){promptAgentContextNodes=collectPromptAgentContext();if(reset)promptAgentContextSelection=new Set(promptAgentContextNodes.map(node=>node.id));else promptAgentContextSelection=new Set([...promptAgentContextSelection].filter(id=>nodes.some(node=>node.id===id)));const list=promptAgentPanel.querySelector<HTMLElement>('[data-agent-context-list]')!,selectedNodes=selectedPromptAgentNodes(),hint=promptAgentPanel.querySelector<HTMLElement>('.agent-selection-hint')!;promptAgentPanel.classList.toggle('has-materials',selectedNodes.length>0);hint.querySelector('span')!.textContent=selectedNodes.length?`已选择 ${selectedNodes.length} 个素材 · 点击卡片可增减`:'点击卡片选择素材';if(!selectedNodes.length){list.innerHTML='<small>点击卡片添加素材</small>';return}list.innerHTML=selectedNodes.map((node,index)=>`<button type="button" class="active" title="${escapeHtml(node.title)}" data-agent-context-node="${node.id}">${node.mediaUrl&&node.kind==='image'?`<img src="${escapeHtml(node.mediaUrl)}" alt="">`:`<i>${node.kind==='image'?'▧':node.kind==='video'?'▶':'T'}</i>`}<span><b>素材 ${index+1}</b><small>${escapeHtml(node.title)}</small></span><em>✓</em></button>`).join('');list.querySelectorAll<HTMLButtonElement>('[data-agent-context-node]').forEach(button=>button.addEventListener('click',()=>{promptAgentContextSelection.delete(Number(button.dataset.agentContextNode));renderPromptAgentContext(false);draw()}))}
function formPromptAgent(){window.clearTimeout(promptAgentFormTimer);promptAgentContextSelection.clear();promptAgentContextNodes=[];renderPromptAgentContext(false);positionPromptAgentCapsule();const trigger=promptAgentTrigger.getBoundingClientRect(),panel=promptAgentPanel.getBoundingClientRect(),originX=Math.max(0,Math.min(panel.width,trigger.left+trigger.width/2-panel.left)),originY=Math.max(0,Math.min(panel.height,trigger.top+trigger.height/2-panel.top));promptAgentPanel.style.setProperty('--agent-origin-x',`${originX}px`);promptAgentPanel.style.setProperty('--agent-origin-y',`${originY}px`);positionPromptAgentParticles();promptAgentBurst.classList.add('hover-active');promptAgentPanel.classList.add('forming');promptAgentTrigger.classList.add('active');promptAgentFormTimer=window.setTimeout(()=>{promptAgentFormTimer=0;promptAgentPanel.classList.remove('forming');promptAgentPanel.classList.add('open');promptAgentSelecting=true;promptAgentPanel.querySelector('textarea')?.focus();startPromptAgentEffects();draw()},40)}
promptAgentTrigger.addEventListener('pointerenter',playPromptAgentHover)
promptAgentTrigger.addEventListener('pointerleave',stopPromptAgentHover)
promptAgentTrigger.addEventListener('click',event=>{event.stopPropagation();const touchToggle=matchMedia('(pointer: coarse)').matches||innerWidth<=800;if(touchToggle&&promptAgentPanel.classList.contains('open')){dispersePromptAgentDirect();return}if(promptAgentPanel.classList.contains('forming')){window.clearTimeout(promptAgentFormTimer);promptAgentFormTimer=0;promptAgentPanel.classList.remove('forming');promptAgentPanel.classList.add('open');promptAgentSelecting=true;promptAgentPanel.querySelector('textarea')?.focus();draw();return}if(!promptAgentPanel.classList.contains('open'))formPromptAgent()})
promptAgentPanel.querySelectorAll<HTMLButtonElement>('[data-agent-kind]').forEach(button=>button.addEventListener('click',()=>{promptAgentKind=button.dataset.agentKind as 'image'|'video';promptAgentPanel.querySelectorAll('[data-agent-kind]').forEach(item=>item.classList.toggle('active',item===button))}))
promptAgentPanel.querySelectorAll<HTMLButtonElement>('[data-agent-complexity]').forEach(button=>button.addEventListener('click',()=>{promptAgentComplexity=button.dataset.agentComplexity as 'simple'|'detailed';promptAgentPanel.querySelectorAll('[data-agent-complexity]').forEach(item=>item.classList.toggle('active',item===button));promptAgentPanel.querySelector<HTMLElement>('.agent-submit b')!.textContent=promptAgentComplexity==='simple'?'生成简洁提示词':'生成详细提示词'}))
let comicPlan:ComicPlan|null=null,comicSubmitting=false,comicOriginalIdea='',comicLinkedLabelId=0
function comicLabels(){return nodes.filter(node=>node.kind==='prompt'&&node.body.trim()).sort((a,b)=>b.id-a.id)}
function renderComicLabelState(){const linked=nodes.find(node=>node.id===comicLinkedLabelId),card=comicStudio.querySelector<HTMLElement>('[data-comic-linked-label]')!,picker=comicStudio.querySelector<HTMLButtonElement>('[data-comic-label-picker]')!,save=comicStudio.querySelector<HTMLButtonElement>('[data-comic-label]')!,copy=comicStudio.querySelector<HTMLButtonElement>('[data-comic-label-copy]')!;picker.querySelector('b')!.textContent=linked?'更换标签':'关联标签';card.hidden=!linked;card.innerHTML=linked?`<span><i>◇</i><span><small>正在延续</small><b>${escapeHtml(linked.title)}</b></span></span><button type="button" aria-label="取消关联">×</button>`:'';card.querySelector('button')?.addEventListener('click',()=>{comicLinkedLabelId=0;comicPlan=null;comicOriginalIdea='';comicStudio.querySelector<HTMLElement>('.comic-plan')!.hidden=true;renderComicLabelState()});save.querySelector('span')!.textContent=linked?'更新原标签':'保存为标签';copy.hidden=!linked}
function renderComicLabelMenu(){const menu=comicStudio.querySelector<HTMLElement>('[data-comic-label-menu]')!,labels=comicLabels();menu.innerHTML=`<header><b>选择故事标签</b><small>读取后可继续对话修改</small></header>${labels.length?labels.map(label=>`<button type="button" data-comic-label-id="${label.id}" class="${label.id===comicLinkedLabelId?'active':''}"><i>◇</i><span><b>${escapeHtml(label.title||'未命名标签')}</b><small>${escapeHtml(label.body.replace(/\s+/g,' ').trim().slice(0,90)||'暂无内容')}</small></span><em>${label.id===comicLinkedLabelId?'✓':'›'}</em></button>`).join(''):'<p>当前画布还没有可用标签</p>'}`;menu.querySelectorAll<HTMLButtonElement>('[data-comic-label-id]').forEach(button=>button.addEventListener('click',()=>{const label=nodes.find(node=>node.id===Number(button.dataset.comicLabelId));if(!label)return;comicLinkedLabelId=label.id;comicOriginalIdea=label.body;const saved=label.comicData as ComicPlan|undefined;if(saved?.shots&&Array.isArray(saved.shots)){comicPlan=structuredClone(saved);renderComicPlan(comicPlan)}else{comicPlan=null;comicStudio.querySelector<HTMLElement>('.comic-plan')!.hidden=true}menu.classList.remove('open');renderComicLabelState();const conversation=comicStudio.querySelector<HTMLElement>('[data-comic-conversation]')!,notice=document.createElement('div');notice.className='comic-message assistant compact';notice.innerHTML=`<i>◇</i><div><b>已读取《${escapeHtml(label.title)}》</b><p>${saved?'可以直接告诉我需要修改或续写的部分。':'这是旧版文本标签，我会先理解内容，再按你的要求整理。'}</p></div>`;conversation.insertBefore(notice,comicStudio.querySelector('.comic-plan'));comicStudio.querySelector<HTMLTextAreaElement>('[data-comic-message]')!.focus()}))}
function openComicStudio(){const seed=promptAgentPanel.querySelector<HTMLTextAreaElement>('textarea')!.value.trim();resetMarqueeRightGesture();if(multiSelectMode)exitMultiSelectMode();closePromptAgent();comicStudio.classList.add('open');promptAgentPanel.classList.add('comic-hidden');renderComicLabelState();const field=comicStudio.querySelector<HTMLTextAreaElement>('[data-comic-message]')!;if(seed&&!field.value)field.value=seed;field.focus()}
function closeComicStudio(){comicStudio.classList.remove('open');promptAgentPanel.classList.remove('comic-hidden');closePromptAgent()}
function renderComicPlan(plan:ComicPlan){const panel=comicStudio.querySelector<HTMLElement>('.comic-plan')!;panel.hidden=false;const frameCount=plan.shots.reduce((sum,shot)=>sum+(shot.frames?.length||1),0);comicStudio.querySelector<HTMLElement>('[data-comic-title]')!.textContent=plan.title||'未命名漫剧';comicStudio.querySelector<HTMLElement>('[data-comic-logline]')!.textContent=plan.logline||'';comicStudio.querySelector<HTMLElement>('[data-comic-meta]')!.textContent=`${plan.duration} · ${plan.aspectRatio} · ${plan.shots.length} 个制作镜头 · ${frameCount} 张分镜图`;const assets=[...(plan.characters||[]).map(character=>`<div class="comic-character"><b>角色 · ${escapeHtml(character.name)}</b><p>${escapeHtml(character.description)}</p></div>`),...(plan.props||[]).map(prop=>`<div class="comic-character"><b>道具 · ${escapeHtml(prop.name)}</b><p>${escapeHtml(prop.description)}</p></div>`)];comicStudio.querySelector<HTMLElement>('[data-comic-characters]')!.innerHTML=assets.join('')||'<p>本方案没有需要单独锁定的视觉资产</p>';comicStudio.querySelector<HTMLElement>('[data-comic-outline]')!.innerHTML=(plan.outline||[]).map(item=>`<li><b>${escapeHtml(item.act)}</b><span>${escapeHtml(item.content)}</span></li>`).join('');comicStudio.querySelector<HTMLElement>('[data-comic-shots]')!.innerHTML=plan.shots.map(shot=>{const frames=shot.frames?.length?shot.frames:[{title:'主画面',imagePrompt:shot.imagePrompt}];return `<details class="comic-shot"><summary><em>${String(shot.number).padStart(2,'0')}</em><span><b>${escapeHtml(shot.title)}</b><small>${shot.duration} 秒 · ${frames.length} 张连续分镜 · ${escapeHtml(shot.scene)}</small></span><i>⌄</i></summary><div>${shot.storyBeat?`<p><b>剧情节拍</b>${escapeHtml(shot.storyBeat)}</p>`:''}${shot.action?`<p><b>表演动作</b>${escapeHtml(shot.action)}</p>`:''}<p><b>对白 / 旁白</b>${escapeHtml(shot.dialogue||'无对白，以画面动作推进')}</p>${frames.map((frame,index)=>`<p><b>分镜 ${index+1} · ${escapeHtml(frame.title)}</b>${escapeHtml(frame.imagePrompt)}</p>`).join('')}<p><b>动态</b>${escapeHtml(shot.videoPrompt)}</p>${shot.continuity?`<p><b>连续性</b>${escapeHtml(shot.continuity)}</p>`:''}${shot.transition?`<p><b>转场</b>${escapeHtml(shot.transition)}</p>`:''}</div></details>`}).join('');const conversation=comicStudio.querySelector<HTMLElement>('[data-comic-conversation]')!;conversation.scrollTo({top:conversation.scrollHeight,behavior:'smooth'})}
async function requestComicPlan(message:string){
  if(comicSubmitting)return;if(!message.trim()){showToast('和灵感说说你的想法','warning');return}
  const revision=comicPlan||comicLinkedLabelId?message.trim():'';if(!comicPlan&&!comicLinkedLabelId)comicOriginalIdea=message.trim();const conversation=comicStudio.querySelector<HTMLElement>('[data-comic-conversation]')!,userMessage=document.createElement('div');userMessage.className='comic-message user';userMessage.innerHTML=`<div><p>${escapeHtml(message.trim())}</p></div>`;conversation.insertBefore(userMessage,comicStudio.querySelector('.comic-plan'));comicSubmitting=true
  const status=comicStudio.querySelector<HTMLOutputElement>('[data-comic-status]')!,send=comicStudio.querySelector<HTMLButtonElement>('[data-comic-send]')!;send.disabled=true;send.classList.add('thinking');status.textContent=revision?'正在理解你的修改…':'正在理解故事想法…';status.classList.add('visible');const selectedContexts=selectedPromptAgentNodes(),linkedLabel=nodes.find(node=>node.id===comicLinkedLabelId),context=[...(linkedLabel?[`已关联故事标签「${linkedLabel.title}」：\n${linkedLabel.body}`]:[]),...selectedContexts.map((node,index)=>`素材 ${index+1}「${node.title}」：${node.generationPrompt||node.body||'视觉参考'}`)],visuals=selectedContexts.filter(node=>node.kind==='image'&&node.mediaUrl).map(node=>node.mediaUrl!)
  try{
    let payload:ComicPlan|null=null,lastError:unknown
    for(let attempt=1;attempt<=1&&!payload;attempt++){try{const response=await fetch('/api/agents/comic',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idea:comicOriginalIdea,context,visuals,previousPlan:comicPlan,revision,model:'gpt-5.5'})});if(!response.ok){const failure=await response.json() as {error?:string};throw new Error(failure.error||'漫剧方案生成失败')}if(!response.body)throw new Error('浏览器未收到漫剧响应流');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',lastPhase='正在构思…';while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line) as {type:string;message?:string;phase?:string;progress?:number;receivedBytes?:number;idleSeconds?:number;error?:string;data?:ComicPlan};if(event.type==='start')status.textContent=event.message||'正在构思…';else if(event.type==='progress'){lastPhase=event.phase||lastPhase;const amount=event.receivedBytes?` · 已接收 ${(event.receivedBytes/1024).toFixed(1)} KB`:'';status.textContent=`${lastPhase} · ${event.progress||0}%${amount}`}else if(event.type==='heartbeat'){const amount=event.receivedBytes?` · 已接收 ${(event.receivedBytes/1024).toFixed(1)} KB`:'';const waiting=(event.idleSeconds||0)>=10?` · 已等待 ${event.idleSeconds} 秒`:' · 持续接收中';status.textContent=`${lastPhase} · ${event.progress||0}%${amount}${waiting}`}else if(event.type==='error')throw new Error(event.error||'漫剧策划流已中断');else if(event.type==='result'&&event.data)payload=event.data}}if(!payload)throw new Error('漫剧方案未完整返回')}catch(error){lastError=error}}
    if(!payload)throw lastError instanceof Error?lastError:new Error('与漫剧策划服务的连接中断')
    if(!payload)throw new Error('漫剧方案未完整返回');comicPlan=payload;renderComicPlan(payload);const assistant=document.createElement('div');assistant.className='comic-message assistant compact';assistant.innerHTML=`<i>✦</i><div><b>${revision?'已经按你的想法调整':'我整理好第一版方案了'}</b><p>${escapeHtml(revision?(payload.changeSummary||'未提及的部分保持不变。'):`《${payload.title}》共 ${payload.shots.length} 个镜头，你可以继续告诉我任何想修改的地方。`)}</p></div>`;conversation.insertBefore(assistant,comicStudio.querySelector('.comic-plan'));status.textContent=revision?'方案已更新':'第一版方案已完成';conversation.scrollTo({top:conversation.scrollHeight,behavior:'smooth'})
  }catch(error){const messageText=error instanceof Error?error.message:'漫剧方案生成失败';status.textContent=messageText;showToast(messageText,'error')}finally{comicSubmitting=false;send.disabled=false;send.classList.remove('thinking');window.setTimeout(()=>status.classList.remove('visible'),2600)}
}
function applyComicToCanvas(){
  if(!comicPlan)return
  resetMarqueeRightGesture();if(multiSelectMode)exitMultiSelectMode()
  try{
    const steps:PromptAgentStep[]=[],characterSteps:number[]=[],characterFormSteps=new Map<string,number>(),propSteps:number[]=[],sceneSteps=new Map<string,number>(),visualStyle=(comicPlan.tone||'动漫风，统一角色线条、上色、光影与色彩').trim(),styleType=/写实|摄影|真人|电影实拍/.test(visualStyle)?'写实风':/拟人/.test(visualStyle)?'拟人风':/三维|3D|卡通渲染/.test(visualStyle)?'三维卡通风':/插画|绘本|水彩|国画/.test(visualStyle)?'插画风':'动漫风',styleLock=`\n风格类型：${styleType}。统一视觉规范：${visualStyle}。本节点必须明确保持该风格类型；角色、道具、场景、分镜和视频使用一致的绘制媒介、线条、上色、材质、光影与色彩体系，不得自行切换到其他风格。`
    comicPlan.characters.forEach((character,index)=>{const nonVisual=character.visualAsset===false||/无实体|没有实体|旁白|系统之声/.test(`${character.name}${character.description}`);if(nonVisual){characterSteps[index]=0;return}const basePrompt=`专业角色设定图（Character Design Sheet），16:9 横向画布，纯净中性背景。对象：${character.name}。${character.description}。${character.imagePrompt||''}\n版式要求：画面中是同一个人物、同一套 Base 造型、同一身体比例，依次展示全身正面、严格 90° 侧面、全身背面三视图，站姿自然且手臂不要遮挡服装结构。增加独立细节区：头部与五官近景、正侧面发型结构、服装内外层与接缝、腰带和扣件、手套、鞋靴；剧情关键的武器、装备、饰品、徽记分别做局部放大，清楚表现形状、佩戴位置、材质、颜色和磨损。保持年龄感、脸型、肤色、发色、瞳色、身高体型和轮廓完全一致。禁止生成三个不同人物、动作海报、透视夸张或复杂场景。${styleLock}`;steps.push({title:`角色 ${index+1} · ${character.name} · Base`,kind:'image',prompt:basePrompt,referenceIndexes:[],dependsOn:[],aspectRatio:'16:9',stage:'character',autoGenerate:true});const baseStep=steps.length;characterSteps[index]=baseStep;(character.forms||[]).forEach(form=>{const formPrompt=`严格参考连接的「${character.name} · Base」人物设定图，保持脸型、五官、发型、肤色、身高、体型和身份锚点完全一致。制作「${form.name}」形态的专业三视图角色设定板：${form.description}。${form.imagePrompt||''}\n16:9 横向纯净背景，同一人物依次展示全身正面、严格侧面、背面；另设局部细节区，重点放大该形态变化的服饰层、伤势或身体变化、武器、装备、饰品、徽记及材质。只改变该形态明确要求的部分，不得重新设计人物，不得混入 Base 或其他形态的服饰。${styleLock}`;steps.push({title:`角色 ${index+1} · ${character.name} · ${form.name}`,kind:'image',prompt:formPrompt,referenceIndexes:[],dependsOn:[baseStep],aspectRatio:'16:9',stage:'character',autoGenerate:true});characterFormSteps.set(`${index+1}:${form.name}`,steps.length)})})
    ;(comicPlan.props||[]).forEach((prop,index)=>{steps.push({title:`道具 ${index+1} · ${prop.name}`,kind:'image',prompt:`${prop.imagePrompt||`${prop.name}道具设定图，${prop.description}，纯背景，材质、尺寸与特征清楚`}${styleLock}`,referenceIndexes:[],dependsOn:[],aspectRatio:comicPlan!.aspectRatio,stage:'prop',autoGenerate:true});propSteps[index]=steps.length})
    let storyboardCount=0,previousShotLastFrame=0,previousShotSceneKey='',previousShotPropIndexes:number[]=[]
    comicPlan.shots.forEach((shot,index)=>{
      const location=shot.scene.match(/卧室|客厅|教室|走廊|办公室|广场|街道|巷道|车站|车厢|商场|医院|病房|餐厅|酒吧|仓库|工厂|实验室|森林|山谷|海滩|屋顶|庭院|宫殿|城门|战场|虚空/)?.[0],sceneKey=location?`location:${location}`:shot.sceneId?.trim()||`scene-${index+1}`;let sceneStep=sceneSteps.get(sceneKey)
      if(!sceneStep){steps.push({title:`场景 · ${shot.title}`,kind:'image',prompt:`${shot.scenePrompt||`无人物环境基准图，${shot.scene}`}。这是无人物环境设定图，但必须与角色使用同一种视觉媒介和渲染方式。${styleLock}`,referenceIndexes:[],dependsOn:[],aspectRatio:comicPlan!.aspectRatio,stage:'scene',autoGenerate:true});sceneStep=steps.length;sceneSteps.set(sceneKey,sceneStep)}
      const characterEvidence=`${shot.scene}${shot.storyBeat||''}${shot.action||''}${shot.dialogue}${shot.imagePrompt}${JSON.stringify(shot.frames||[])}`,mentionedCharacterIndexes=comicPlan!.characters.map((character,characterIndex)=>characterEvidence.includes(character.name)?characterIndex+1:0).filter(Boolean),declaredCharacterIndexes=shot.characterIndexes||[],characterIndexes=declaredCharacterIndexes.length&&mentionedCharacterIndexes.length?declaredCharacterIndexes.filter(value=>mentionedCharacterIndexes.includes(value)):declaredCharacterIndexes.length?declaredCharacterIndexes:mentionedCharacterIndexes,selectedForms=new Map((shot.characterForms||[]).map(selection=>[selection.characterIndex,selection.form])),characterDependencies=characterIndexes.map(value=>characterFormSteps.get(`${value}:${selectedForms.get(value)}`)||characterSteps[value-1]).filter(Boolean),currentPropIndexes=shot.propIndexes||[],propDependencies=currentPropIndexes.map(value=>propSteps[value-1]).filter(Boolean),newPropDependencies=currentPropIndexes.filter(value=>!previousShotPropIndexes.includes(value)).map(value=>propSteps[value-1]).filter(Boolean),frames=shot.frames?.length?shot.frames:[{title:'主画面',imagePrompt:shot.imagePrompt}],frameSteps:number[]=[],formGuide=[...selectedForms].filter(([characterIndex])=>characterIndexes.includes(characterIndex)).map(([characterIndex,form])=>`${comicPlan!.characters[characterIndex-1]?.name||`角色${characterIndex}`}使用「${form}」形态`).join('；'),continuesPrevious=Boolean(previousShotLastFrame&&previousShotSceneKey===sceneKey)
      frames.forEach((frame,frameIndex)=>{const continuityGuide=frameIndex===0&&continuesPrevious?`\n镜头衔接：严格承接所连接的上一镜头末帧，保持人物位置、动作结束状态、视线、服饰、道具状态、环境光线和空间方向连续；上一分镜已经提供场景和既有道具信息，不得重置或重新设计。${shot.continuity?`连续性说明：${shot.continuity}`:''}`:'';const framePrompt=`${frame.imagePrompt||shot.imagePrompt}${formGuide?`\n人物形态要求：${formGuide}。严格沿用对应形态节点的服饰与状态，不得恢复 Base 或混用其他形态。`:''}${continuityGuide}${styleLock}`,continuityFrame=frameIndex?frameSteps[frameIndex-1]:continuesPrevious?previousShotLastFrame:0,referenceCandidates=continuityFrame?[continuityFrame,...characterDependencies,...(frameIndex?[]:newPropDependencies)]:[sceneStep,...characterDependencies,...propDependencies],frameDependencies=[...new Set(referenceCandidates.filter(Boolean))].slice(0,4);steps.push({title:`分镜 ${shot.number}.${frameIndex+1} · ${frame.title||shot.title}`,kind:'image',prompt:framePrompt,referenceIndexes:shot.referenceIndexes,dependsOn:frameDependencies,aspectRatio:comicPlan!.aspectRatio,stage:'storyboard',autoGenerate:true});frameSteps.push(steps.length);storyboardCount++})
      const spokenText=(shot.dialogue||'').trim(),hasSpeech=spokenText&&!/^无对白/.test(spokenText),speakingCharacters=comicPlan!.characters.filter(character=>new RegExp(`${character.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*[：:]`).test(spokenText)),voiceProfiles=speakingCharacters.map(character=>`${character.name}：${character.voiceProfile||'自然中文普通话，声线符合角色年龄与性格，跨镜头保持一致'}`).join('；'),hasNarration=/(?:^|[\n；。])\s*旁白\s*[：:]/.test(spokenText),videoDialogueGuide=hasSpeech?`\n对白 / 旁白：${spokenText}\n语言与声线：全程使用自然中文普通话，不得改说英语，不得省略或改写台词。${voiceProfiles?`角色声线——${voiceProfiles}。`:''}${hasNarration?'旁白使用沉稳清晰、与角色声线可区分的中文旁白声线；旁白时画面角色不得张嘴。':''}同一角色跨镜头保持相同音色、音高、语速和说话习惯。\n表演要求：按台词顺序安排说话者的准确中文口型、呼吸、停顿、重音、表情和动作反应；未说话角色保持自然倾听反应。`:`\n对白 / 旁白：${spokenText||'无对白，以画面动作推进'}\n表演要求：本镜头不安排人物说话口型，以动作、表情和环境声音推进，不生成含混人声。`
      steps.push({title:`镜头 ${shot.number} · ${shot.title}`,kind:'video',prompt:`${shot.videoPrompt}${videoDialogueGuide}${styleLock}\n视频风格连续性：把连接的分镜图作为角色身份和画风基准，只执行动作、表情、运镜与环境变化；人物、场景和材质始终保持“${styleType}”，不得在视频过程中切换风格。`,referenceIndexes:[],dependsOn:frameSteps,duration:shot.duration,aspectRatio:comicPlan!.aspectRatio,stage:'video',autoGenerate:false})
      previousShotLastFrame=frameSteps.at(-1)||0;previousShotSceneKey=sceneKey;previousShotPropIndexes=[...currentPropIndexes]
    })
    const result:PromptAgentResult={model:comicPlan.model||'gpt-5.5',kind:'video',subject:'',scene:'',composition:'',lighting:'',style:comicPlan.tone||'',motion:'',negativePrompt:'',finalPrompt:comicPlan.logline,action:'create_new',targetType:'video',summary:`《${comicPlan.title}》已铺设角色、道具、场景、连续分镜与视频工作流`,shouldGenerate:false,layout:'comic-workflow',steps}
    applyPromptAgentPlan(result);closeComicStudio();showToast(`工作流已铺到画布：${comicPlan.characters.length} 个角色、${comicPlan.props?.length||0} 个道具、${sceneSteps.size} 个场景、${storyboardCount} 张分镜`,'success');window.setTimeout(()=>showCanvasGuide({key:'comic-empty-images-guide',title:'工作流已就绪，先检查再生成',detail:'可先替换需要复用的图片，并检查模型、尺寸与提示词；确认后点击顶栏“启动空图”，一次加入全部空图任务。',tone:'online',priority:58,duration:10000,actions:[{label:'知道了',run:()=>hideCanvasGuide('comic-empty-images-guide')},{label:'启动空图',primary:true,run:()=>{hideCanvasGuide('comic-empty-images-guide');startAllEmptyImages()}}]}),420)
  }catch(error){const message=error instanceof Error?error.message:'未知错误';showToast('铺设漫剧工作流失败','error',message);clientLog('comic_canvas_apply_failed',{message,shots:comicPlan.shots.length,nodes:nodes.length})}
}
function comicPlanText(plan:ComicPlan){const characterText=plan.characters.map(character=>`【角色·${character.name}】${character.description}`).join('\n'),propText=(plan.props||[]).map(prop=>`【道具·${prop.name}】${prop.description}`).join('\n'),outlineText=plan.outline.map(item=>`【${item.act}】${item.content}`).join('\n'),shotText=plan.shots.map(shot=>{const frames=shot.frames?.length?shot.frames:[{title:'主画面',imagePrompt:shot.imagePrompt}];return `${String(shot.number).padStart(2,'0')}｜${shot.title}｜${shot.duration} 秒\n${shot.storyBeat?`剧情节拍：${shot.storyBeat}\n`:''}${shot.action?`表演动作：${shot.action}\n`:''}画面：${shot.scene}\n对白/旁白：${shot.dialogue||'无对白，以画面动作推进'}\n${frames.map((frame,index)=>`分镜 ${index+1}·${frame.title}：${frame.imagePrompt}`).join('\n')}\n动态：${shot.videoPrompt}${shot.continuity?`\n连续性：${shot.continuity}`:''}`}).join('\n\n');return `《${plan.title}》\n${plan.logline}\n\n时长：${plan.duration}　画幅：${plan.aspectRatio}\n风格：${plan.tone}\n\n—— 视觉资产 ——\n${characterText}${propText?`\n${propText}`:''}\n\n—— 剧情大纲 ——\n${outlineText}\n\n—— 制作分镜 ——\n${shotText}`}
function saveComicAsLabel(copy=false){if(!comicPlan)return;let label=!copy?nodes.find(node=>node.id===comicLinkedLabelId):undefined;if(!label){const rightEdge=nodes.length?Math.max(...nodes.map(node=>node.x+node.width)):world({x:innerWidth/2,y:innerHeight/2}).x-220;addNode('prompt',{x:rightEdge+180,y:world({x:innerWidth/2,y:innerHeight/2}).y-280});label=nodes.find(node=>node.id===selectedId)}if(!label)return;label.title=`漫剧方案 · ${comicPlan.title}`;label.body=comicPlanText(comicPlan);label.comicData=structuredClone(comicPlan);label.width=440;label.height=560;label.fontScale=.92;comicLinkedLabelId=label.id;renderComicLabelState();scheduleSave();draw();showToast(copy?'漫剧方案已另存为新标签':'漫剧方案已保存并可继续修改','success')}
promptAgentPanel.querySelector<HTMLButtonElement>('.agent-comic-entry')!.addEventListener('click',event=>{event.stopPropagation();openComicStudio()})
comicStudio.querySelector('[data-comic-close]')!.addEventListener('click',closeComicStudio)
comicStudio.querySelector('[data-comic-new]')!.addEventListener('click',()=>{if(comicSubmitting){showToast('请等待当前构思完成后再开始新会话','warning');return}comicPlan=null;comicOriginalIdea='';comicLinkedLabelId=0;renderComicLabelState();comicStudio.querySelectorAll('.comic-message:not(.comic-welcome)').forEach(message=>message.remove());comicStudio.querySelector<HTMLElement>('.comic-plan')!.hidden=true;comicStudio.querySelector<HTMLTextAreaElement>('[data-comic-message]')!.value='';comicStudio.querySelector<HTMLOutputElement>('[data-comic-status]')!.classList.remove('visible');comicStudio.querySelector<HTMLTextAreaElement>('[data-comic-message]')!.focus();showToast('已开始新的漫剧会话','success')})
const comicMessage=comicStudio.querySelector<HTMLTextAreaElement>('[data-comic-message]')!
function sendComicMessage(){const message=comicMessage.value.trim();if(!message)return;comicMessage.value='';void requestComicPlan(message)}
comicStudio.querySelector('[data-comic-send]')!.addEventListener('click',sendComicMessage)
comicMessage.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendComicMessage()}})
comicStudio.querySelector('[data-comic-canvas]')!.addEventListener('click',applyComicToCanvas)
comicStudio.querySelector('[data-comic-label-picker]')!.addEventListener('click',event=>{event.stopPropagation();const menu=comicStudio.querySelector<HTMLElement>('[data-comic-label-menu]')!;if(menu.classList.contains('open')){menu.classList.remove('open');return}renderComicLabelMenu();menu.classList.add('open')})
comicStudio.querySelector('[data-comic-label]')!.addEventListener('click',()=>saveComicAsLabel(false))
comicStudio.querySelector('[data-comic-label-copy]')!.addEventListener('click',()=>saveComicAsLabel(true))
comicStudio.addEventListener('click',event=>{if(!(event.target as HTMLElement).closest('.comic-label-control'))comicStudio.querySelector('[data-comic-label-menu]')?.classList.remove('open')})
function applyPromptAgentPlan(result:PromptAgentResult){
  const sources=selectedPromptAgentNodes(),current=sources[0],kind=result.targetType||result.kind,canUpdate=current&&current.kind===kind&&current.role!=='result'&&!current.mediaUrl,action=result.action==='update_current'&&canUpdate?'update_current':result.action==='create_new'?'create_new':'create_child'
  promptAgentUndo=null;promptAgentAppliedNodeId=0
  const planned=(result.steps||[]).filter(step=>(step.kind==='image'||step.kind==='video')&&step.prompt?.trim()).slice(0,192)
  if(planned.length){
    const imageSources=sources.filter(source=>source.kind==='image'&&Boolean(source.mediaUrl)),createdIds:number[]=[],rightEdge=nodes.length?Math.max(...nodes.map(node=>node.x+node.width)):0,base={x:rightEdge+230,y:current?current.y+80:world({x:innerWidth/2,y:innerHeight/2}).y},stageRows={character:0,prop:0,scene:0,storyboard:0,video:0}
    planned.forEach((step,index)=>{const storyboard=result.layout==='storyboard',shotIndex=Math.floor(index/2),stage=step.stage||'storyboard',comicWorkflow=result.layout==='comic-workflow',position=comicWorkflow?{x:base.x+({character:0,prop:1,scene:2,storyboard:3,video:4}[stage])*390,y:base.y+(stageRows[stage]++)*280}:storyboard?{x:base.x+Math.floor(shotIndex/3)*900+(index%2)*390,y:base.y+(shotIndex%3)*300}:{x:base.x+Math.floor(index/3)*390,y:base.y+(index%3)*270};addNode(step.kind,position,true);const created=nodes.find(node=>node.id===selectedId);if(!created)return;if(comicWorkflow&&step.kind==='image')created.model='gpt-image-2';created.body=step.prompt.trim();created.generationPrompt=step.prompt.trim();created.title=step.title?.trim()||`Agent · ${step.kind==='video'?'视频':'图像'} ${index+1}`;created.agentAuto=Boolean(result.shouldGenerate)&&step.autoGenerate!==false;created.status=created.agentAuto?'waiting':'idle';if(step.kind==='video'){created.videoSettings={...(created.videoSettings||{}),seconds:String(Math.max(3,Math.min(8,Number(step.duration)||5))),aspectRatio:['9:16','16:9','1:1','4:3'].includes(String(step.aspectRatio))?String(step.aspectRatio):created.videoSettings?.aspectRatio||'16:9'}}if(step.kind==='image'&&comicWorkflow){const imageSize=step.aspectRatio==='9:16'?'864x1536':step.aspectRatio==='1:1'?'1024x1024':'1536x864';created.imageSettings={...(created.imageSettings||{}),size:imageSize,quality:'high'}}createdIds.push(created.id);const indexes=(step.referenceIndexes||[]).map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=imageSources.length),references=indexes.map(value=>imageSources[value-1]),dependencies=(step.dependsOn||[]).map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=index).map(value=>nodes.find(node=>node.id===createdIds[value-1])).filter((node):node is FlowNode=>Boolean(node)),inputs=[...references,...dependencies].filter((source,inputIndex,list)=>list.findIndex(candidate=>candidate.id===source.id)===inputIndex);if(step.kind==='image'&&comicWorkflow&&inputs.length){const guide=`严格参考连接素材：${inputs.map((source,inputIndex)=>`输入图 ${inputIndex+1}「${source.title}」`).join('、')}。保持其中人物身份、服装、道具外观和场景结构一致，不得互换或重新设计。`;created.body=`${step.prompt.trim()}\n${guide}`;created.generationPrompt=created.body}inputs.forEach((source,inputIndex)=>{if(!links.some(link=>link.from===source.id&&link.to===created.id))links.push({from:source.id,to:created.id,fromSide:'right',toSide:'left',inputOrder:inputIndex+1})})})
    if(result.layout==='comic-workflow')nodes.filter(node=>createdIds.includes(node.id)&&node.kind==='video').forEach(node=>{node.videoSettings={seconds:'5',aspectRatio:'16:9',...(node.videoSettings||{}),resolution:'480p'}})
    promptAgentAppliedNodeId=createdIds[0]||0;promptAgentUndo=()=>{for(let index=links.length-1;index>=0;index--)if(createdIds.includes(links[index].from)||createdIds.includes(links[index].to))links.splice(index,1);for(let index=nodes.length-1;index>=0;index--)if(createdIds.includes(nodes[index].id))nodes.splice(index,1);selectedId=0;promptAgentAppliedNodeId=0;scheduleSave();draw()};selectedId=promptAgentAppliedNodeId;scheduleSave();draw();if(result.shouldGenerate)queueMicrotask(runAgentWorkflow);return
  }
  if(action==='update_current'&&current){
    const before={body:current.body,generationPrompt:current.generationPrompt,title:current.title}
    current.body=result.finalPrompt;current.generationPrompt=result.finalPrompt;current.title=kind==='video'?'Agent · 视频任务':'Agent · 图像任务';promptAgentAppliedNodeId=current.id
    promptAgentUndo=()=>{current.body=before.body;current.generationPrompt=before.generationPrompt;current.title=before.title;selectedId=current.id;scheduleSave();draw()}
  }else{
    const anchor=action==='create_child'&&current?{x:current.x+current.width+120,y:current.y+current.height/2}:world({x:innerWidth/2,y:innerHeight/2})
    addNode(kind,anchor);const created=nodes.find(node=>node.id===selectedId);if(!created)return
    created.body=result.finalPrompt;created.generationPrompt=result.finalPrompt;created.title=kind==='video'?'Agent · 视频任务':'Agent · 图像任务';promptAgentAppliedNodeId=created.id
    if(action==='create_child')sources.filter(source=>source.id!==created.id).forEach((source,inputIndex)=>{if(!links.some(link=>link.from===source.id&&link.to===created.id))links.push({from:source.id,to:created.id,fromSide:'right',toSide:'left',inputOrder:inputIndex+1})})
    promptAgentUndo=()=>{const index=nodes.findIndex(node=>node.id===created.id);if(index>=0)nodes.splice(index,1);for(let index=links.length-1;index>=0;index--)if(links[index].from===created.id||links[index].to===created.id)links.splice(index,1);if(selectedId===created.id)selectedId=0;promptAgentAppliedNodeId=0;scheduleSave();draw()}
  }
  selectedId=promptAgentAppliedNodeId;scheduleSave();draw()
}
promptAgentPanel.querySelector<HTMLButtonElement>('.agent-submit')!.addEventListener('click',async()=>{const textarea=promptAgentPanel.querySelector<HTMLTextAreaElement>('textarea')!,idea=textarea.value.trim(),submit=promptAgentPanel.querySelector<HTMLButtonElement>('.agent-submit')!,status=promptAgentPanel.querySelector<HTMLOutputElement>('.agent-status')!,article=promptAgentPanel.querySelector<HTMLElement>('article')!,selected=nodes.find(node=>node.id===selectedId);if(!idea){showToast('先告诉我你想创造什么','warning');return}promptAgentRequestController?.abort();const controller=new AbortController(),version=++promptAgentRequestVersion;promptAgentRequestController=controller;promptAgentKind=/视频|动态|动起来|镜头运动|运镜/.test(idea)?'video':'image';const selectedContexts=selectedPromptAgentNodes(),context=selectedContexts.map((node,index)=>`${index===0?'当前节点':`参考节点${index+1}`}「${node.title}」：${node.generationPrompt||node.body||'无文字说明'}`),visuals=selectedContexts.filter(node=>node.kind==='image'&&node.mediaUrl).map(node=>node.mediaUrl!);submit.classList.add('is-running');submit.title='再次点击可打断并重新执行';status.textContent=version>1?'已打断上一次，正在重新规划…':'正在理解素材并规划画布…';article.hidden=true;try{const response=await fetch('/api/agents/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idea,kind:promptAgentKind,complexity:promptAgentComplexity,context,visuals,model:promptAgentModelSelect.value,target:selected?{id:selected.id,kind:selected.kind,role:selected.role||'generator',hasMedia:Boolean(selected.mediaUrl),hasPrompt:Boolean((selected.generationPrompt||selected.body).trim())}:null}),signal:controller.signal}),responseText=await response.text();let result:PromptAgentResult&{error?:string};try{result=JSON.parse(responseText) as PromptAgentResult&{error?:string}}catch{throw new Error(response.status===504?'灵感规划超时，请再次尝试':'灵感服务暂时不可用，请稍后重试')}if(version!==promptAgentRequestVersion)return;if(!response.ok)throw new Error(result.error||'创作规划失败');promptAgentResult=result;applyPromptAgentPlan(result);playAgentMeteor();article.querySelector<HTMLElement>('[data-agent-prompt]')!.textContent=result.finalPrompt;article.querySelector<HTMLElement>('[data-agent-summary]')!.textContent=result.summary||'已根据你的素材准备好画布节点';article.querySelector('small')!.textContent=`${result.model} · ${(result.targetType||result.kind)==='video'?'视频':'图像'} · ${selectedContexts.length} 个参考`;article.querySelector<HTMLButtonElement>('[data-agent-undo]')!.hidden=!promptAgentUndo;status.textContent='画布已更新';textarea.value='';showToast(result.summary||'创作节点已准备','success')}catch(error){if(controller.signal.aborted||version!==promptAgentRequestVersion)return;const message=error instanceof Error?error.message:'创作规划失败';status.textContent=message;showToast(message,'error')}finally{if(version===promptAgentRequestVersion){promptAgentRequestController=null;submit.classList.remove('is-running');submit.title=''}}})
promptAgentPanel.querySelector('[data-agent-copy]')!.addEventListener('click',async()=>{if(!promptAgentResult)return;await navigator.clipboard.writeText(promptAgentResult.finalPrompt);showToast('提示词已复制','success')})
promptAgentPanel.querySelector('[data-agent-undo]')!.addEventListener('click',()=>{if(!promptAgentUndo)return;promptAgentUndo();promptAgentUndo=null;promptAgentPanel.querySelector<HTMLButtonElement>('[data-agent-undo]')!.hidden=true;promptAgentPanel.querySelector<HTMLOutputElement>('.agent-status')!.textContent='已撤销刚才的画布操作'})
promptAgentPanel.querySelector('[data-agent-locate]')!.addEventListener('click',()=>{const node=nodes.find(item=>item.id===promptAgentAppliedNodeId);if(!node)return;selectedId=node.id;camera.x=-(node.x+node.width/2)*camera.zoom;camera.y=-(node.y+node.height/2)*camera.zoom;draw();closePromptAgent()})
window.addEventListener('contextmenu',event=>{if(!promptAgentPanel.classList.contains('open'))return;event.preventDefault();event.stopImmediatePropagation();dispersePromptAgentDirect()},true)
window.addEventListener('resize',()=>{if(promptAgentPanel.classList.contains('open')){positionPromptAgentCapsule();positionPromptAgentRibbons()}})
document.querySelector('#dock-clear')!.addEventListener('click', async () => {if(!nodes.length)return;if(!window.confirm('确定清除当前画布中的全部节点和连线吗？'))return;const cancelJobs=window.confirm('是否同时取消当前项目中排队和生成中的任务？\n\n确定：清空并取消任务\n取消：只清空画布，任务继续并保存到资产库');if(cancelJobs&&currentProjectId){try{const response=await fetch(`/api/projects/${currentProjectId}/jobs/cancel-active`,{method:'POST'}),result=await response.json() as {canceled?:number;error?:string};if(!response.ok)throw new Error(result.error||'取消任务失败');showToast(result.canceled?`已取消 ${result.canceled} 个未完成任务`:'当前没有未完成任务','success')}catch(error){showToast('部分任务取消失败','error',error instanceof Error?error.message:'请稍后重试')}}nodes.splice(0);links.splice(0);selectedId=0;updateEditor();scheduleSave();draw()})
const panelBackdrop = document.querySelector<HTMLElement>('#panel-backdrop')!
const workspacePanels = document.querySelectorAll<HTMLElement>('.workspace-panel')
const workspaceBrand=document.querySelector<HTMLElement>('.topbar .brand')!,mobileNavToggle=document.querySelector<HTMLButtonElement>('#mobile-nav-toggle')!
function closeMobileWorkspaceMenu(){workspaceBrand.classList.remove('mobile-menu-open');mobileNavToggle.setAttribute('aria-expanded','false')}
function closeWorkspacePanels() { workspacePanels.forEach(panel => panel.classList.remove('open')); panelBackdrop.classList.remove('open'); document.querySelectorAll('.main-nav button').forEach(button => button.classList.remove('active')); closeMobileWorkspaceMenu(); imageNodeAssetTargetId = null }
function openWorkspacePanel(id: string, trigger: string) { closeWorkspacePanels(); document.querySelector<HTMLElement>(id)!.classList.add('open'); panelBackdrop.classList.add('open'); document.querySelector<HTMLElement>(trigger)!.classList.add('active') }
document.querySelector('#open-projects')!.addEventListener('click', () => { openWorkspacePanel('#projects-panel', '#open-projects'); void loadProjects() })
document.querySelector('#open-assets')!.addEventListener('click', () => { openWorkspacePanel('#assets-panel', '#open-assets'); if (!libraryAssets.length) void loadAssets() })
document.querySelector('#open-square')!.addEventListener('click', () => { openWorkspacePanel('#square-panel', '#open-square'); void loadSquare() })
mobileNavToggle.addEventListener('click',event=>{if(innerWidth>780)return;event.stopPropagation();const opening=!workspaceBrand.classList.contains('mobile-menu-open');closeTopbarMenus(opening?'workspace':undefined);if(opening)workspaceBrand.classList.add('mobile-menu-open');mobileNavToggle.setAttribute('aria-expanded',String(opening))})
workspaceBrand.querySelector('.main-nav')!.addEventListener('click',event=>event.stopPropagation())
document.addEventListener('click',closeMobileWorkspaceMenu)
window.addEventListener('resize',()=>{if(innerWidth>780)closeMobileWorkspaceMenu()})
document.querySelectorAll('.panel-close').forEach(button => button.addEventListener('click', closeWorkspacePanels))
panelBackdrop.addEventListener('click', closeWorkspacePanels)
const assetUpload = document.querySelector<HTMLInputElement>('#asset-upload')!, assetGrid = document.querySelector<HTMLElement>('#asset-grid')!, assetCount = document.querySelector<HTMLElement>('#asset-count')!
const assetPreview = document.querySelector<HTMLElement>('#asset-preview')!, previewImage = document.querySelector<HTMLImageElement>('#preview-image')!, previewVideo = document.querySelector<HTMLVideoElement>('#preview-video')!, previewName = document.querySelector<HTMLElement>('#preview-name')!
let contextUploadPosition: Point | null = null
let imageNodeAssetTargetId: number | null = null
let draggingAsset: { url: string; name: string; kind: 'image' | 'video' } | null = null
let selectedAsset: { id: string; url: string; name: string; kind: 'image' | 'video'; isPublic: boolean } | null = null
type LibraryAsset = { id: string; projectId: string; projectName: string; name: string; mimeType: string; size: number; createdAt: string; url: string; thumbnailUrl?: string; isPublic: boolean }
let libraryAssets: LibraryAsset[] = [], assetView: 'grid' | 'list' = 'grid'
const selectedAssetIds = new Set<string>(), assetSearch = document.querySelector<HTMLInputElement>('#asset-search')!, assetProjectFilter = document.querySelector<HTMLSelectElement>('#asset-project-filter')!, assetTypeFilter = document.querySelector<HTMLSelectElement>('#asset-type-filter')!, assetSort = document.querySelector<HTMLSelectElement>('#asset-sort')!
const assetContextMenu = document.querySelector<HTMLElement>('#asset-context-menu')!
let assetTouchHold:{pointerId:number;start:Point;timer:number}|null=null,assetTouchContextUntil=0
function openAssetContextAt(asset:LibraryAsset,x:number,y:number){const kind=asset.mimeType.startsWith('video/')?'video' as const:'image' as const;selectedAsset={id:asset.id,url:asset.url,name:asset.name,kind,isPublic:asset.isPublic};document.querySelector<HTMLElement>('#asset-context-publish span')!.textContent=asset.isPublic?'从主页撤下':'展示到主页';const width=innerWidth<=800?210:190,height=250;assetContextMenu.style.left=`${Math.max(10,Math.min(x-18,innerWidth-width-10))}px`;assetContextMenu.style.top=`${Math.max(10,Math.min(y-24,innerHeight-height-10))}px`;assetContextMenu.classList.add('open')}
function clearAssetTouchHold(){if(!assetTouchHold)return;window.clearTimeout(assetTouchHold.timer);assetTouchHold=null}
function visibleLibraryAssets(){const query=assetSearch.value.trim().toLocaleLowerCase(),scope=assetProjectFilter.value,type=imageNodeAssetTargetId?'image':assetTypeFilter.value,sort=assetSort.value;return libraryAssets.filter(asset=>(scope==='all'||asset.projectId===currentProjectId)&&(type==='all'||asset.mimeType.startsWith(`${type}/`))&&asset.name.toLocaleLowerCase().includes(query)).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):sort==='oldest'?Date.parse(a.createdAt)-Date.parse(b.createdAt):Date.parse(b.createdAt)-Date.parse(a.createdAt))}
function assetForRenderedItem(item:HTMLElement){const index=[...assetGrid.querySelectorAll<HTMLElement>('.asset-item')].indexOf(item);return index>=0?visibleLibraryAssets()[index]:undefined}
assetGrid.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;const item=(event.target as HTMLElement|null)?.closest<HTMLElement>('.asset-item');if(!item)return;clearAssetTouchHold();const start={x:event.clientX,y:event.clientY},pointerId=event.pointerId,asset=assetForRenderedItem(item);if(!asset)return;const timer=window.setTimeout(()=>{if(!assetTouchHold||assetTouchHold.pointerId!==pointerId)return;assetTouchContextUntil=performance.now()+900;openAssetContextAt(asset,start.x,start.y);if(navigator.vibrate)navigator.vibrate(16);clearAssetTouchHold()},450);assetTouchHold={pointerId,start,timer}},true)
assetGrid.addEventListener('pointermove',event=>{if(assetTouchHold?.pointerId===event.pointerId&&Math.hypot(event.clientX-assetTouchHold.start.x,event.clientY-assetTouchHold.start.y)>9)clearAssetTouchHold()},true)
for(const type of ['pointerup','pointercancel'] as const)window.addEventListener(type,event=>{if(assetTouchHold?.pointerId===event.pointerId)clearAssetTouchHold()},true)
assetGrid.addEventListener('click',event=>{if(performance.now()<assetTouchContextUntil){event.preventDefault();event.stopImmediatePropagation()}},true)
const imageNodeUpload = document.createElement('input')
imageNodeUpload.type = 'file'; imageNodeUpload.accept = 'image/*'; imageNodeUpload.hidden = true; document.body.append(imageNodeUpload)
function attachAssetToImageNode(nodeId: number, asset: { url: string; name: string }) {
  const node = nodes.find(item => item.id === nodeId && item.kind === 'image')
  if (!node) { showToast('目标图片节点已不存在', 'warning'); return }
  if(node.status==='queued'||node.status==='running'||(node.agentAuto&&node.status==='waiting')){showToast('节点已经进入生成队列，未替换素材','warning');return}
  node.mediaUrl = asset.url; node.title = asset.name || node.title; node.generationPrompt = undefined; node.status = 'idle'; node.progress = 0
  selectedId = node.id; scheduleSave(); updateEditor(); draw(); showToast('图片已放入当前节点', 'success')
}
function imageNodeAllowsSourceChange(nodeId:number){const node=nodes.find(item=>item.id===nodeId&&item.kind==='image');if(!node)return false;if(node.status==='queued'||node.status==='running'||(node.agentAuto&&node.status==='waiting')){showToast('生成期间不可更换素材','warning');return false}return true}
function beginImageNodeUpload(nodeId: number) { if(!imageNodeAllowsSourceChange(nodeId))return;imageNodeAssetTargetId = null; imageNodeUpload.dataset.nodeId = String(nodeId); imageNodeUpload.value = ''; imageNodeUpload.click() }
async function beginImageNodeLibrary(nodeId: number) {
  if(!imageNodeAllowsSourceChange(nodeId))return;openWorkspacePanel('#assets-panel', '#open-assets'); imageNodeAssetTargetId = nodeId; assetTypeFilter.value = 'image'; assetProjectFilter.value = 'current'; await loadAssets(); renderAssets()
}
imageNodeUpload.addEventListener('change', () => { const files = [...(imageNodeUpload.files ?? [])], nodeId = Number(imageNodeUpload.dataset.nodeId); if (files.length && Number.isFinite(nodeId)) void uploadImageFiles(files, null, false, nodeId) })
document.querySelector('#upload-assets')!.addEventListener('click', () => assetUpload.click())
document.querySelector('#dock-upload')!.addEventListener('click', () => assetUpload.click())
;[assetSearch, assetProjectFilter, assetTypeFilter, assetSort].forEach(control => control.addEventListener('input', renderAssets))
document.querySelectorAll<HTMLButtonElement>('[data-asset-view]').forEach(button => button.addEventListener('click', () => { assetView = button.dataset.assetView as 'grid' | 'list'; document.querySelectorAll('[data-asset-view]').forEach(item => item.classList.toggle('active', item === button)); renderAssets() }))
document.querySelector('#asset-bulk-delete')!.addEventListener('click', async () => { if (!selectedAssetIds.size) return; const confirmed = await askProjectDialog({ title: '删除所选资产？', description: `将永久删除所选的 ${selectedAssetIds.size} 项资产，此操作无法撤销。`, confirm: '确认删除', danger: true }); if (!confirmed) return; const results = await Promise.all([...selectedAssetIds].map(id => fetch(`/api/assets/${id}`, { method: 'DELETE' }))); if (results.some(response => !response.ok)) showToast('部分资产删除失败', 'error'); else showToast('所选资产已删除', 'success'); selectedAssetIds.clear(); await loadAssets() })
document.querySelector('#asset-bulk-download')!.addEventListener('click', async () => { for (const asset of libraryAssets.filter(item => selectedAssetIds.has(item.id))) { const response = await fetch(asset.url); if (!response.ok) continue; const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = asset.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000) } })
type ProjectSummary = { id: string; name: string; createdAt: string; updatedAt: string; lastOpenedAt: string; assetCount: number; nodeCount: number; previewUrl?: string | null }
let projectSummaries: ProjectSummary[] = []
const projectSearch = document.querySelector<HTMLInputElement>('#project-search')!, projectSort = document.querySelector<HTMLSelectElement>('#project-sort')!, projectDialog = document.querySelector<HTMLElement>('#project-dialog')!
projectSort.options[0].textContent = '最近进入'
document.querySelector('#new-project')!.addEventListener('click', async () => { const name = await askProjectDialog({ title: '新建项目', description: '给新的创作空间取一个容易识别的名称。', value: `未命名项目 ${projectSummaries.length + 1}`, confirm: '创建项目' }); if (!name) return; const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); if (!response.ok) { showToast('项目创建失败', 'error'); return } const project = await response.json() as { id: string }; await switchProject(project.id) })
projectSearch.addEventListener('input', renderProjects)
projectSort.addEventListener('change', renderProjects)
async function uploadImageFiles(files: File[], placement: Point | null, pasted = false, targetNodeId?: number) {
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) { showToast('仅支持上传图片', 'warning'); return }
  const button = document.querySelector<HTMLButtonElement>('#upload-assets')!
  button.disabled = true; button.textContent = '正在上传…'
  try {
    const payload = await Promise.all(images.map(async file => ({ name: file.name || `粘贴图片-${Date.now()}.png`, mimeType: file.type, data: await fileBase64(file) })))
    const response = await fetch(`/api/projects/${currentProjectId}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: payload }) })
    if (!response.ok) throw new Error(response.status === 413 ? '图片过大，单张图片不能超过 100MB' : `上传失败（${response.status}）`)
    const uploaded = await response.json() as Array<{ name: string; mimeType: string; url: string }>
    if (targetNodeId && uploaded[0]) attachAssetToImageNode(targetNodeId, uploaded[0])
    else if (placement && uploaded[0]) addMediaNode(uploaded[0].url, uploaded[0].name, placement, 'image')
    await loadAssets()
    if (pasted) showToast('图片已粘贴到画布中心', 'success')
  } catch (error) {
    showToast('图片上传失败', 'error', error instanceof Error ? error.message : '请重试')
  } finally {
    button.disabled = false; button.textContent = '↑ 上传图片'; assetUpload.value = ''; assetUpload.accept = 'image/*'; assetUpload.multiple = true
  }
}
assetUpload.addEventListener('change', () => {
  const files = [...(assetUpload.files ?? [])], placement = contextUploadPosition
  contextUploadPosition = null
  if (files.length) void uploadImageFiles(files, placement)
})
window.addEventListener('paste', event => {
  const image = [...(event.clipboardData?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
  if (!image) return
  event.preventDefault()
  const namedImage = image.name ? image : new File([image], `粘贴图片-${Date.now()}.${image.type.split('/')[1] || 'png'}`, { type: image.type })
  void uploadImageFiles([namedImage], world({ x: innerWidth / 2, y: innerHeight / 2 }), true)
})
async function loadProjects() { const response = await fetch('/api/projects'); if (!response.ok) { showToast('项目列表加载失败', 'error'); return } projectSummaries = (await response.json() as ProjectSummary[]).map(project => ({ ...project, updatedAt: project.lastOpenedAt || project.updatedAt })); renderProjects() }
function renderProjects() { const list = document.querySelector<HTMLElement>('#project-list')!, query = projectSearch.value.trim().toLocaleLowerCase(), sort = projectSort.value; const projects = projectSummaries.filter(project => project.name.toLocaleLowerCase().includes(query)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'created' ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); document.querySelector<HTMLElement>('#project-count')!.textContent = `${projectSummaries.length} 个项目`; list.innerHTML = ''; if (!projects.length) { list.innerHTML = `<div class="project-list-empty"><b>⌕</b><span>${query ? '没有匹配的项目' : '还没有项目'}</span><small>${query ? '换个关键词试试' : '创建一个项目开始创作'}</small></div>`; return } for (const project of projects) { const card = document.createElement('article'); card.className = `project-card${project.id === currentProjectId ? ' active' : ''}`; card.innerHTML = `<i class="project-preview">${project.previewUrl ? `<img src="${project.previewUrl}" alt="" loading="lazy">` : '<span>∞</span>'}</i><span class="project-copy"><span class="project-name"><strong>${escapeHtml(project.name)}</strong><button data-project-action="rename" type="button" aria-label="修改项目名称" title="修改名称"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"></path></svg></button></span><small>${project.id === currentProjectId ? '<em>当前项目</em> · ' : ''}${formatProjectTime(project.updatedAt)}</small><small>${project.nodeCount ?? 0} 个节点 · ${project.assetCount ?? 0} 项资产</small></span><button class="project-enter" type="button">进入</button><button data-project-action="delete" class="project-delete" type="button" aria-label="删除项目" title="删除项目"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg></button>`; card.querySelector<HTMLElement>('.project-preview')!.addEventListener('click', () => void switchProject(project.id)); card.querySelector<HTMLButtonElement>('.project-enter')!.addEventListener('click', () => void switchProject(project.id)); card.querySelectorAll<HTMLButtonElement>('[data-project-action]').forEach(button => button.addEventListener('click', () => void handleProjectAction(button.dataset.projectAction!, project))); list.append(card) } }
async function handleProjectAction(action: string, project: ProjectSummary) { if (action === 'rename') { const name = await askProjectDialog({ title: '重命名项目', description: '项目中的画布和资产不会受到影响。', value: project.name, confirm: '保存名称' }); if (!name || name === project.name) return; const response = await fetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); if (!response.ok) { showToast('项目重命名失败', 'error'); return } showToast('项目名称已更新', 'success') } else if (action === 'duplicate') { const confirmed = await askProjectDialog({ title: '创建项目副本', description: `将复制“${project.name}”的画布和全部资产，公开状态不会复制。`, confirm: '创建副本' }); if (!confirmed) return; const response = await fetch(`/api/projects/${project.id}/duplicate`, { method: 'POST' }); if (!response.ok) { showToast('项目复制失败', 'error'); return } showToast('项目副本已创建', 'success') } else if (action === 'delete') { const confirmed = await askProjectDialog({ title: '删除项目？', description: `“${project.name}”中的画布和资产将被永久删除，此操作无法撤销。`, confirm: '确认删除', danger: true }); if (!confirmed) return; const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' }); if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; showToast('项目删除失败', 'error', result.error === '至少需要保留一个项目' ? result.error : '请稍后重试'); return } if (project.id === currentProjectId) { const next = projectSummaries.find(item => item.id !== project.id); if (next) { currentProjectId = next.id; localStorage.setItem('flow-project-id', next.id); await Promise.all([loadCanvas(), loadAssets()]) } } showToast('项目已删除', 'success') } await loadProjects() }
function askProjectDialog(options: { title: string; description: string; value?: string; confirm: string; danger?: boolean }) { return new Promise<string | boolean>(resolve => { const form = projectDialog.querySelector<HTMLFormElement>('form')!, label = form.querySelector<HTMLLabelElement>('label')!, input = form.querySelector<HTMLInputElement>('input')!, confirm = form.querySelector<HTMLButtonElement>('[data-dialog-confirm]')!; form.querySelector('h2')!.textContent = options.title; form.querySelector('p')!.textContent = options.description; label.hidden = options.value === undefined; input.value = options.value ?? ''; input.required = options.value !== undefined; confirm.textContent = options.confirm; confirm.classList.toggle('danger', Boolean(options.danger)); projectDialog.classList.add('open'); const finish = (result: string | boolean) => { projectDialog.classList.remove('open'); form.onsubmit = null; form.querySelector<HTMLButtonElement>('[data-dialog-cancel]')!.onclick = null; resolve(result) }; form.onsubmit = event => { event.preventDefault(); finish(options.value === undefined ? true : input.value.trim()) }; form.querySelector<HTMLButtonElement>('[data-dialog-cancel]')!.onclick = () => finish(false); if (!label.hidden) requestAnimationFrame(() => { input.focus(); input.select() }) }) }
function formatProjectTime(value: string) { const time = Date.parse(value), delta = Date.now() - time; if (!Number.isFinite(time)) return '最近进入'; if (delta < 60_000) return '刚刚进入'; if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前进入`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前进入`; return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(time)) }
async function switchProject(projectId: string) { if (projectId === currentProjectId) { closeWorkspacePanels(); return } await saveCanvas(); currentProjectId = projectId; localStorage.setItem('flow-project-id', projectId); await Promise.all([loadCanvas(), loadAssets()]); closeWorkspacePanels() }
async function loadAssets() { const response = await fetch('/api/assets'); if (!response.ok) return; libraryAssets = await response.json() as LibraryAsset[]; renderAssets() }
function renderAssets() {
  const assets=visibleLibraryAssets()
  assetCount.textContent=imageNodeAssetTargetId?`${assets.length} 张图片 · 点击复用到节点`:`${assets.length} 项${selectedAssetIds.size?` · 已选 ${selectedAssetIds.size}`:''}`
  assetGrid.className=`asset-grid ${assetView==='list'?'is-list':''}${imageNodeAssetTargetId?' is-picking':''}`
  assetGrid.innerHTML=assets.length?'':'<div class="asset-empty"><b>◇</b><span>没有匹配的素材</span><small>尝试调整项目范围、类型或关键词</small></div>'
  for(const asset of assets){
    const item=document.createElement('article'),kind=asset.mimeType.startsWith('video/')?'video' as const:'image' as const
    item.className=`asset-item${asset.isPublic?' is-public':''}${selectedAssetIds.has(asset.id)?' selected':''}`
    item.innerHTML=`<img src="${asset.thumbnailUrl||mediaThumbnailUrl(asset.url)}" alt="" draggable="false" loading="lazy" decoding="async"><i class="asset-kind-indicator">${kind==='video'?'▶':''}</i><button class="asset-select" type="button" aria-label="选择资产">${selectedAssetIds.has(asset.id)?'✓':''}</button><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.projectName||'当前项目')} · ${formatFileSize(asset.size)}</small></footer>`
    item.draggable=false
    item.title=imageNodeAssetTargetId?'单击复用到当前图片节点':'单击查看 · 长按或右击更多操作'
    item.querySelector<HTMLButtonElement>('.asset-select')!.addEventListener('click',event=>{event.stopPropagation();if(selectedAssetIds.has(asset.id))selectedAssetIds.delete(asset.id);else selectedAssetIds.add(asset.id);renderAssets()})
    item.addEventListener('click',()=>{if(performance.now()<assetTouchContextUntil)return;if(imageNodeAssetTargetId&&kind==='image'){const targetId=imageNodeAssetTargetId;imageNodeAssetTargetId=null;attachAssetToImageNode(targetId,asset);closeWorkspacePanels();return}openAssetPreview(asset.url,asset.name,kind)})
    item.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();openAssetContextAt(asset,event.clientX,event.clientY)})
    assetGrid.append(item)
  }
  const disabled=selectedAssetIds.size===0
  document.querySelector<HTMLButtonElement>('#asset-bulk-delete')!.disabled=disabled
  document.querySelector<HTMLButtonElement>('#asset-bulk-download')!.disabled=disabled
}
function formatFileSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB` }
type SquareAsset = { id: string; name: string; mimeType: string; createdAt: string; author: string; url: string; thumbnailUrl?: string }
let squareAssets: SquareAsset[] = []
const squareGrid = document.querySelector<HTMLElement>('#square-grid')!, squareSearch = document.querySelector<HTMLInputElement>('#square-search')!
async function loadSquare() { squareGrid.classList.add('loading'); try { const response = await fetch('/api/showcase'); if (!response.ok) throw new Error('load failed'); squareAssets = await response.json() as SquareAsset[]; renderSquare() } catch { squareGrid.innerHTML = '<div class="asset-empty"><b>◇</b><span>作品暂时无法加载</span><small>稍后再试</small></div>' } finally { squareGrid.classList.remove('loading') } }
function renderSquare() { const query = squareSearch.value.trim().toLocaleLowerCase(), assets = squareAssets.filter(asset => `${asset.name} ${asset.author}`.toLocaleLowerCase().includes(query)); document.querySelector<HTMLElement>('#square-count')!.textContent = `${assets.length} 项`; squareGrid.innerHTML = assets.length ? '' : '<div class="asset-empty"><b>◇</b><span>没有找到作品</span><small>换个关键词试试</small></div>'; for (const asset of assets) { const video = asset.mimeType.startsWith('video/'), card = document.createElement('article'); card.className = 'square-card'; card.tabIndex = 0; card.innerHTML = `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"><i>${video ? '▶' : '⌕'}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || 'Viora 创作者')}</small></footer>`; const open = () => openAssetPreview(asset.url, asset.name, video ? 'video' : 'image'); card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter') open() }); squareGrid.append(card) } }
squareSearch.addEventListener('input', renderSquare)
document.querySelector('#square-refresh')!.addEventListener('click', () => void loadSquare())
function openAssetPreview(url: string, name: string, kind: 'image' | 'video' = 'image') { previewName.textContent = name; previewImage.hidden = kind === 'video'; previewVideo.hidden = kind !== 'video'; if (kind === 'video') previewVideo.src = url; else { previewImage.src = url; previewImage.alt = name } assetPreview.classList.add('open') }
async function downloadNodeImage(node: FlowNode) {
  if (!node.mediaUrl) return
  try {
    const response = await fetch(node.mediaUrl)
    if (!response.ok) throw new Error(`原图读取失败（${response.status}）`)
    const blob = await response.blob()
    const mime = blob.type.split(';')[0].toLowerCase()
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' } as Record<string, string>)[mime] ?? 'png'
    const title = (node.title || '图片').trim().replace(/[\\/:*?"<>|]/g, '-') || '图片'
    const filename = /\.[a-z0-9]{2,5}$/i.test(title) ? title : `${title}.${extension}`
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (error) {
    showToast('图片下载失败', 'error', error instanceof Error ? error.message : '请稍后重试')
  }
}
function closeAssetPreview() { assetPreview.classList.remove('open'); previewImage.removeAttribute('src'); previewVideo.pause(); previewVideo.removeAttribute('src') }
document.querySelector('#close-preview')!.addEventListener('click', closeAssetPreview)
assetPreview.addEventListener('click', event => { if (event.target === assetPreview) closeAssetPreview() })
document.querySelector('#asset-context-place')!.addEventListener('click', () => { if (selectedAsset) addMediaNode(selectedAsset.url, selectedAsset.name, world({ x: innerWidth / 2, y: innerHeight / 2 }), selectedAsset.kind); assetContextMenu.classList.remove('open'); closeWorkspacePanels() })
document.querySelector('#asset-context-preview')!.addEventListener('click', () => { if (selectedAsset) openAssetPreview(selectedAsset.url, selectedAsset.name, selectedAsset.kind); assetContextMenu.classList.remove('open') })
document.querySelector('#asset-context-publish')!.addEventListener('click', async () => { if (!selectedAsset) return; const next = !selectedAsset.isPublic; const response = await fetch(`/api/assets/${selectedAsset.id}/visibility`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isPublic: next }) }); assetContextMenu.classList.remove('open'); if (!response.ok) { showToast('主页展示状态更新失败', 'error'); return } selectedAsset.isPublic = next; showcaseLoaded = false; showToast(next ? '作品已展示到主页' : '作品已从主页撤下', 'success'); await loadAssets() })
document.querySelector('#asset-context-delete')!.addEventListener('click', async () => { if (!selectedAsset || !window.confirm(`确定删除“${selectedAsset.name}”吗？`)) return; const response = await fetch(`/api/assets/${selectedAsset.id}`, { method: 'DELETE' }); if (!response.ok) { window.alert('删除失败，请重试'); return } imageCache.delete(selectedAsset.url); selectedAsset = null; assetContextMenu.classList.remove('open'); await loadAssets() })
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = draggingAsset ? 'copy' : 'none' })
document.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); if (!draggingAsset) return; const asset = draggingAsset; draggingAsset = null; closeWorkspacePanels(); addMediaNode(asset.url, asset.name, world({ x: event.clientX, y: event.clientY }), asset.kind) })
function escapeHtml(value: string) { const element = document.createElement('span'); element.textContent = value; return element.innerHTML }
function fileBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }) }
document.addEventListener('pointerdown', event => {
  const target = event.target as Node
  if (!quickNodeMenu.contains(target)) closeQuickNodeMenu()
  if (!assetContextMenu.contains(target)) assetContextMenu.classList.remove('open')
  document.querySelectorAll<HTMLDetailsElement>('.image-config-panel details[open],.video-config-panel details[open]').forEach(details => { if (!details.contains(target)) details.open = false })
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && quickNodeMenu.classList.contains('open')) { closeQuickNodeMenu(); return }
  if (event.key === 'Escape' && nodeInfoModal.classList.contains('open')) { closeNodeInfo(); return }
  if (event.key === 'Escape' && assetPreview.classList.contains('open')) { closeAssetPreview(); return }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault(); deleteSelectedNode()
})
function refreshLocalImageAvailabilityUI(){/* 本地 Provider 暂不在模型列表展示 */}
async function loadGenerationCapabilities(redraw=false) { try { const response = await fetch('/api/generation/capabilities',{cache:'no-store'}); if (response.ok) { const previous=generationCapabilities.image?.localFallback?.available; generationCapabilities = await response.json() as GenerationCapabilities; if(redraw&&previous!==generationCapabilities.image?.localFallback?.available){refreshLocalImageAvailabilityUI();draw()} } } catch { /* 使用通用默认配置 */ } }
async function bootstrapApplication() {
  setWorkspaceBootStatus('正在检测登录状态')
  try { const response = await fetch('/api/users/me'); if (response.ok) authUser = await response.json() as AuthUser } catch { authUser = null }
  authReady = true; localStorage.removeItem('flow-authenticated'); renderAuthenticatedUser();if(authUser){lastUserActivity=Date.now();scheduleIdleLogout()}
  const capabilities=loadGenerationCapabilities()
  if (authUser && location.hash === '#/canvas') {
    setWorkspaceBootStatus('登录成功，正在加载项目')
    if(await ensureCurrentUserProject()) { setWorkspaceBootStatus('正在恢复画布资源'); await Promise.all([loadCanvas(),loadAssets(),capabilities]) }
  } else await capabilities
  setWorkspaceBootStatus('',false)
  applyAppRoute()
}
window.addEventListener('resize', resize); resize(); updateEditor(); void bootstrapApplication()
setInterval(()=>void loadGenerationCapabilities(true),15000)

const idleLogoutMs=30*60*1000
let lastUserActivity=Date.now(),activityHeartbeatDue=false,idleLogoutTimer=0
function scheduleIdleLogout(){window.clearTimeout(idleLogoutTimer);if(!authUser)return;const remaining=Math.max(0,idleLogoutMs-(Date.now()-lastUserActivity));idleLogoutTimer=window.setTimeout(()=>void logoutToHome('长时间未操作，已安全退出登录'),remaining)}
function recordUserActivity(){lastUserActivity=Date.now();activityHeartbeatDue=true;scheduleIdleLogout()}
for(const eventName of ['pointerdown','keydown','wheel','touchstart'] as const)window.addEventListener(eventName,recordUserActivity,{passive:true})
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||!authUser)return;if(Date.now()-lastUserActivity>=idleLogoutMs)void logoutToHome('长时间未操作，已安全退出登录');else scheduleIdleLogout()})
window.setInterval(async()=>{if(!authUser||!activityHeartbeatDue)return;activityHeartbeatDue=false;const response=await fetch('/api/auth/activity',{method:'POST'}).catch(()=>null);if(response?.status===401)void logoutToHome('登录状态已过期，请重新登录')},60_000)
