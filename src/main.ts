import './style.css'

type Point = { x: number; y: number }
type NodeKind = 'prompt' | 'image' | 'video' | 'note'
type PortSide = 'top' | 'right' | 'bottom' | 'left'
type FlowNode = Point & { id: number; publicId?: string; kind: NodeKind; role?: 'generator' | 'result'; sourceNodeId?: number; width: number; height: number; title: string; body: string; generationPrompt?: string; accent: string; model?: string; jobId?: string; progress?: number; status?: string; mediaUrl?: string; fontScale?: number; agentAuto?:boolean; imageSettings?: { size?: string; quality?: string; background?: string }; videoSettings?: { seconds?: string; resolution?: string; aspectRatio?: string } }
type FlowLink = { from: number; to: number; fromSide: PortSide; toSide: PortSide; inputOrder?: number }
type GenerationCapabilities = { image?: { defaultModel: string }; video?: { defaultModel: string; seconds: { min: number; max: number; default: number }; resolutions: string[]; aspectRatios: string[] } }
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
const jobLabel = document.querySelector<HTMLSpanElement>('#job-label')!
const jobProgress = document.querySelector<HTMLElement>('#job-progress')!
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!
const camera = { x: 80, y: 10, zoom: 0.9 }
const pointer = { down: false, x: 0, y: 0, draggingNode: null as number | null }
let selectedId = 0
let editingTextNodeId = 0
let nextId = 1
let contextPosition: Point = { x: 0, y: 0 }
let connecting: { nodeId: number; side: PortSide; pointer: Point } | null = null
let connectionSnap: { nodeId: number; side: PortSide } | null = null
let hoveredLinkIndex = -1
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

async function copyOriginalPrompt(prompt?: string) {
  const value = prompt?.trim()
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
async function checkForAppUpdate() {
  if (updateNoticeShown || !initialAppAssets || document.visibilityState === 'hidden') return
  try {
    const response = await fetch(`/?app-version=${Date.now()}`, { cache:'no-store', headers:{ 'cache-control':'no-cache' } })
    if (!response.ok) return
    const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html')
    const nextAssets = appAssetFingerprint(nextDocument)
    if (!nextAssets || nextAssets === initialAppAssets) return
    updateNoticeShown = true
    const notice = document.createElement('aside')
    notice.className = 'app-update-popover'
    notice.innerHTML = '<i>↻</i><span><b>检测到服务器版本更新</b><small>刷新页面后即可使用最新版本。</small><em><button type="button" data-update-later>稍后</button><button type="button" data-update-reload>刷新生效</button></em></span>'
    const positionNotice = () => { const trigger = document.querySelector<HTMLElement>('#prompt-agent-trigger'); if (!trigger) return; const rect = trigger.getBoundingClientRect(); notice.style.left = `${Math.max(12, Math.min(innerWidth - notice.offsetWidth - 12, rect.left))}px`; notice.style.bottom = `${innerHeight - rect.top + 12}px` }
    notice.querySelector<HTMLButtonElement>('[data-update-reload]')!.addEventListener('click', () => location.reload())
    notice.querySelector<HTMLButtonElement>('[data-update-later]')!.addEventListener('click', () => notice.remove())
    document.body.append(notice); requestAnimationFrame(positionNotice); window.addEventListener('resize', positionNotice, { passive:true })
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
let authUser: AuthUser | null = null
let customApiModels: CustomApiModel[] = []
let authReady = false
let authMode: 'login' | 'register' = 'login'
let showcaseLoaded = false
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
function renderAuthenticatedUser() { const login = document.querySelector<HTMLButtonElement>('#home-login')!, enter = document.querySelector<HTMLButtonElement>('#home-enter')!, userButton = document.querySelector<HTMLButtonElement>('#workspace-user')!, menu = document.querySelector<HTMLElement>('#workspace-user-menu')!, initial = authUser?.name?.slice(0, 1).toUpperCase() ?? 'V', available = Math.max(0,Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0)); login.disabled = Boolean(authUser); login.textContent = authUser ? `${authUser.name} · 已登录` : '登录'; enter.textContent = authUser ? '返回工作台' : '进入工作台'; userButton.querySelector('span')!.textContent = initial; userButton.querySelector('b')!.textContent = authUser?.name ?? '用户'; menu.querySelector('header i')!.textContent = initial; menu.querySelector('strong')!.textContent = authUser?.name ?? ''; menu.querySelector('header small')!.textContent = [authUser?.username ? `@${authUser.username}` : '', authUser?.email ?? ''].filter(Boolean).join(' · '); menu.querySelector<HTMLElement>('#copy-invite-code b')!.textContent = authUser?.inviteCode ?? '—'; const credits = menu.querySelector<HTMLButtonElement>('#open-lab')!; credits.querySelector('small')!.textContent = `${available} 点`; credits.classList.toggle('enabled', available > 0) }
async function ensureCurrentUserProject() { const response = await fetch('/api/projects'); if (!response.ok) return false; const projects = await response.json() as Array<{ id: string }>; if (!projects.length) return false; if (!projects.some(project => project.id === currentProjectId)) { currentProjectId = projects[0].id; localStorage.setItem('flow-project-id', currentProjectId) } return true }
async function enterWorkspace() { if (!authUser || !await ensureCurrentUserProject()) return; location.hash = '#/canvas'; await Promise.all([loadCanvas(), loadAssets(), loadCustomApiModels()]); applyAppRoute() }
async function loadShowcase() {
  showcaseLoaded = true
  try {
    const response = await fetch('/api/showcase')
    if (!response.ok) throw new Error(String(response.status))
    const assets = await response.json() as Array<{ id: string; name: string; mimeType: string; createdAt: string; author: string; url: string }>
    if (!assets.length) return
    homeGallery.innerHTML = ''
    for (const asset of assets) {
      const video = asset.mimeType.startsWith('video/'), card = document.createElement('article')
      card.className = 'home-gallery-card'; card.tabIndex = 0
      card.innerHTML = `${video ? `<video src="${asset.url}" muted playsinline preload="metadata"></video>` : `<img src="${asset.url}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async">`}<i>${video ? '▶' : '⌕'}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || 'Flow 创作者')}</small></footer>`
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
let homeSceneProgress = 0, homeSceneTarget = 0, homeSceneFrame = 0, homeTouchY = 0, homeWheelDelta = 0, homeWheelResetTimer = 0, homeWheelLockedUntil = 0
function setHomeSceneTarget(value: number) {
  homeSceneTarget = Math.max(0, Math.min(3, value))
  if (!homeSceneFrame) homeSceneFrame = requestAnimationFrame(animateHomeScene)
}
function animateHomeScene() {
  homeSceneProgress += (homeSceneTarget - homeSceneProgress) * .16
  if (Math.abs(homeSceneTarget - homeSceneProgress) < .001) homeSceneProgress = homeSceneTarget
  homePage.style.setProperty('--home-progress', homeSceneProgress.toFixed(4))
  homePage.querySelectorAll<HTMLElement>('.home-scene').forEach((element, index) => {
    const distance = index - homeSceneProgress
    element.style.setProperty('--scene-distance', distance.toFixed(4))
    element.style.setProperty('--scene-presence', Math.max(0, 1 - Math.abs(distance)).toFixed(4))
  })
  const scene = Math.max(0, Math.min(3, Math.round(homeSceneProgress)))
  homePage.dataset.scene = String(scene)
  homePage.querySelectorAll<HTMLElement>('[data-home-scene]').forEach(button => button.classList.toggle('active', Number(button.dataset.homeScene) === scene))
  if (homeSceneProgress !== homeSceneTarget) homeSceneFrame = requestAnimationFrame(animateHomeScene)
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
  homeWheelLockedUntil = performance.now() + 620
}, { passive: false })
homePage.querySelectorAll<HTMLElement>('[data-home-scene]').forEach(button => button.addEventListener('click', () => setHomeSceneTarget(Number(button.dataset.homeScene))))
homePage.querySelectorAll<HTMLAnchorElement>('a[href="#showcase"]').forEach(link => link.addEventListener('click', event => { if (innerWidth <= 800) return; event.preventDefault(); setHomeSceneTarget(3) }))
homePage.addEventListener('touchstart', event => { homeTouchY = event.touches[0]?.clientY ?? 0 }, { passive: true })
homePage.addEventListener('touchend', event => { if (innerWidth <= 800) return; const distance = homeTouchY - (event.changedTouches[0]?.clientY ?? homeTouchY); if (Math.abs(distance) > 45) setHomeSceneTarget(Math.round(homeSceneTarget) + (distance > 0 ? 1 : -1)) }, { passive: true })
setHomeSceneTarget(0)
homeLoginModal.querySelector('.home-login-close')!.addEventListener('click', () => homeLoginModal.classList.remove('open'))
homeLoginModal.addEventListener('click', event => { if (event.target === homeLoginModal) homeLoginModal.classList.remove('open') })
homeLoginModal.querySelectorAll<HTMLElement>('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode as 'login' | 'register')))
homeLoginModal.querySelector('form')!.addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement, submit = form.querySelector<HTMLButtonElement>('.home-login-submit')!, error = form.querySelector<HTMLOutputElement>('.home-login-error')!, data = new FormData(form), completedMode = authMode; submit.disabled = true; error.textContent = ''; try { const response = await fetch(`/api/auth/${completedMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), inviteCode: data.get('inviteCode'), email: data.get('email'), password: data.get('password') }) }); const result = await response.json() as AuthUser & { error?: string }; if (!response.ok) throw new Error(result.error || '登录失败'); authUser = result; authReady = true; renderAuthenticatedUser(); homeLoginModal.classList.remove('open'); form.reset(); if (completedMode === 'register') await enterWorkspace(); else showToast(`欢迎回来，${result.name}`, 'success') } catch (reason) { error.textContent = reason instanceof Error ? reason.message : '登录失败，请重试' } finally { submit.disabled = false } })
homePreview.querySelector(':scope > button')!.addEventListener('click', closeHomePreview)
homePreview.addEventListener('click', event => { if (event.target === homePreview) closeHomePreview() })
const workspaceUserMenu = document.querySelector<HTMLElement>('#workspace-user-menu')!
const renameUserButton = document.createElement('button'); renameUserButton.id = 'rename-user'; renameUserButton.type = 'button'; renameUserButton.title = '修改昵称'; renameUserButton.setAttribute('aria-label', '修改昵称'); renameUserButton.textContent = '✎'; workspaceUserMenu.querySelector('header')!.append(renameUserButton)
async function editUserNickname() { if (!authUser) return; const header = workspaceUserMenu.querySelector('header')!, name = header.querySelector<HTMLElement>('strong')!, input = document.createElement('input'); input.className = 'user-name-input'; input.value = authUser.name; input.maxLength = 40; name.hidden = true; renameUserButton.hidden = true; name.after(input); input.focus(); input.select(); let finished = false; const finish = async (save: boolean) => { if (finished) return; finished = true; const nextName = input.value.trim(); input.remove(); name.hidden = false; renameUserButton.hidden = false; if (!save || nextName === authUser!.name) return; if (nextName.length < 2) { showToast('昵称至少需要 2 个字符', 'error'); return } const response = await fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nextName }) }); const result = await response.json().catch(() => ({})) as AuthUser & { error?: string }; if (!response.ok) { showToast(result.error || '昵称修改失败', 'error'); return } authUser = { ...authUser!, name: result.name }; renderAuthenticatedUser(); showToast('昵称已更新', 'success') }; input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void finish(true) } else if (event.key === 'Escape') { event.preventDefault(); void finish(false) } }); input.addEventListener('blur', () => void finish(true)) }
renameUserButton.addEventListener('click', event => { event.stopPropagation(); void editUserNickname() })
document.querySelector('#workspace-user')!.addEventListener('click', event => { event.stopPropagation(); workspaceUserMenu.classList.toggle('open') })
document.querySelector('#workspace-logout')!.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); authUser = null; nodes.splice(0); links.splice(0); selectedId = 0; workspaceUserMenu.classList.remove('open'); renderAuthenticatedUser(); location.hash = '#/'; applyAppRoute() })
document.querySelector('#copy-invite-code')!.addEventListener('click', async () => { if (!authUser?.inviteCode) return; await navigator.clipboard.writeText(authUser.inviteCode); const label = document.querySelector<HTMLElement>('#copy-invite-code span')!; label.textContent = '已复制'; window.setTimeout(() => { label.textContent = '复制' }, 1400) })
document.addEventListener('pointerdown', event => { if (!(event.target as HTMLElement | null)?.closest('#workspace-user,#workspace-user-menu')) workspaceUserMenu.classList.remove('open') })
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
function drawLink(link: FlowLink, index: number) {
  const from = nodes.find(n => n.id === link.from), to = nodes.find(n => n.id === link.to)
  if (!from || !to) return
  const a = screen(portWorld(from, link.fromSide)), b = screen(portWorld(to, link.toSide))
  ctx.beginPath(); ctx.moveTo(a.x, a.y)
  const curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .35)
  const ca = controlPoint(a, link.fromSide, curve), cb = controlPoint(b, link.toSide, curve)
  ctx.bezierCurveTo(ca.x, ca.y, cb.x, cb.y, b.x, b.y)
  const generating = linkIsGenerating(link), hovered = index === hoveredLinkIndex
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
function updateConnectionPointer(sx: number, sy: number) { if (!connecting) return; const target = hitPort(sx, sy, 32, connecting.nodeId); connectionSnap = target ? { nodeId: target.node.id, side: target.side } : null; connecting.pointer = target ? screen(portWorld(target.node, target.side)) : { x: sx, y: sy } }
function hitLink(sx: number, sy: number) {
  for (let index = links.length - 1; index >= 0; index--) {
    const link = links[index], from = nodes.find(node => node.id === link.from), to = nodes.find(node => node.id === link.to)
    if (!from || !to) continue
    const a = screen(portWorld(from, link.fromSide)), b = screen(portWorld(to, link.toSide)), curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .35), ca = controlPoint(a, link.fromSide, curve), cb = controlPoint(b, link.toSide, curve)
    let previous = a
    for (let step = 1; step <= 32; step++) { const t = step / 32, inverse = 1 - t, point = { x: inverse ** 3 * a.x + 3 * inverse ** 2 * t * ca.x + 3 * inverse * t ** 2 * cb.x + t ** 3 * b.x, y: inverse ** 3 * a.y + 3 * inverse ** 2 * t * ca.y + 3 * inverse * t ** 2 * cb.y + t ** 3 * b.y }; const length = Math.hypot(point.x - previous.x, point.y - previous.y) || 1, projection = Math.max(0, Math.min(1, ((sx - previous.x) * (point.x - previous.x) + (sy - previous.y) * (point.y - previous.y)) / (length * length))), distance = Math.hypot(sx - (previous.x + projection * (point.x - previous.x)), sy - (previous.y + projection * (point.y - previous.y))); if (distance <= 9) return index; previous = point }
  }
  return -1
}
function drawPendingLink() { if (!connecting) return; const node = nodes.find(item => item.id === connecting!.nodeId); if (!node) return; const a = screen(portWorld(node, connecting.side)), b = connecting.pointer; ctx.beginPath(); ctx.moveTo(a.x, a.y); const distance = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * .3), control = controlPoint(a, connecting.side, distance); ctx.quadraticCurveTo(control.x, control.y, b.x, b.y); ctx.strokeStyle = node.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]); if (connectionSnap) { ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(47,128,255,.16)'; ctx.fill(); ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#2f80ff'; ctx.fill() } }
function paint() { drawFrame = null; ctx.fillStyle = colorTheme === 'dark' ? '#0b1113' : '#eef3ef'; ctx.fillRect(0, 0, innerWidth, innerHeight); drawGrid(); links.forEach(drawLink); drawPendingLink(); syncDomNodes(); zoomSlider.value = String(Math.round(camera.zoom * 100)); zoomSlider.title = `${Math.round(camera.zoom * 100)}%`; zoomPercent.value = `${Math.round(camera.zoom * 100)}%`; nodeCount.textContent = String(nodes.length); if (links.some(linkIsGenerating)) draw() }
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
function addNode(kind: NodeKind = 'image', position?: Point) { const center = position ?? world({ x: innerWidth / 2, y: innerHeight / 2 }); const titles = { prompt: '标签', image: '文生图 · 新任务', video: '视频生成 · 新任务', note: '创作便签' }; nodes.push({ id: nextId, publicId: makePublicId(kind), kind, x: center.x - 130, y: center.y - 80, width: 265, height: kind === 'note' ? 135 : 175, title: titles[kind], body: kind === 'image' || kind === 'video' ? '' : kind === 'prompt' ? '记录标签、分组标题或画布备注' : '等待配置模型与生成参数', accent: kind === 'video' ? '#ffb774' : kind === 'prompt' ? '#e7ff70' : kind === 'note' ? '#b6efa2' : '#8ee7ff', model: kind === 'video' ? generationCapabilities.video?.defaultModel ?? 'agnes-video-v2.0' : generationCapabilities.image?.defaultModel ?? 'gpt-image-2', videoSettings: kind === 'video' ? { seconds: String(generationCapabilities.video?.seconds.default ?? 5), resolution: generationCapabilities.video?.resolutions[1] ?? '720p', aspectRatio: generationCapabilities.video?.aspectRatios.at(-1) ?? '16:9' } : undefined }); selectedId = nextId++; updateEditor(); scheduleSave(); draw() }
function addMediaNode(url: string, title: string, position = contextPosition, kind: 'image' | 'video' = 'image') { nodes.push({ id: nextId, publicId: makePublicId(kind), kind, role: kind === 'video' ? 'result' : undefined, x: position.x - 145, y: position.y - 120, width: 290, height: 240, title, body: '', accent: kind === 'video' ? '#ffb774' : '#8ee7ff', mediaUrl: url, model: kind === 'video' ? generationCapabilities.video?.defaultModel ?? 'agnes-video-v2.0' : generationCapabilities.image?.defaultModel ?? 'gpt-image-2', videoSettings: kind === 'video' ? { seconds: '5', resolution: '720p', aspectRatio: '16:9' } : undefined }); selectedId = nextId++; updateEditor(); scheduleSave(); draw() }

function syncDomNodes() {
  nodeViewport.style.transform = `translate(${innerWidth / 2 + camera.x}px, ${innerHeight / 2 + camera.y}px) scale(${camera.zoom})`
  const live = new Set(nodes.map(node => String(node.id)))
  nodeLayer.querySelectorAll<HTMLElement>('.flow-node').forEach(element => { if (!live.has(element.dataset.id!)) element.remove() })
  for (const node of nodes) {
    let element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`)
    if (!element) { element = createDomNode(node); nodeLayer.append(element) }
    const locked = nodeIsActivelyGenerating(node) && !(node.kind === 'video' && node.role !== 'result')
    node.width = 280; node.height = 220
    element.className = `flow-node kind-${node.kind}${node.role === 'result' ? ' node-result' : ' node-generator'}${node.id === selectedId ? ' selected' : ''}${promptAgentSelecting&&promptAgentContextSelection.has(node.id)?' agent-reference':''}${locked ? ' generating' : ''}`
    element.querySelectorAll<HTMLElement>('.node-port').forEach(port => { port.hidden = node.kind === 'video' && node.role === 'result' })
    element.style.transform = `translate(${node.x}px, ${node.y}px)`; element.style.width = `${node.width}px`; element.style.height = `${node.height}px`; element.style.setProperty('--accent', node.accent); element.style.setProperty('--font-scale', String(node.fontScale ?? 1))
    const copy = element.querySelector<HTMLElement>('.node-copy')!; if (editingTextNodeId !== node.id) copy.textContent = node.body || defaultNodeCopy(node.kind)
    element.querySelector<HTMLElement>('.node-kind')!.textContent = node.kind === 'prompt' ? 'LABEL' : node.kind === 'note' ? 'NOTE' : node.kind === 'video' ? 'VIDEO' : 'IMAGE'
    if (node.kind === 'video') {
      const emptyState = element.querySelector<HTMLElement>('.image-empty-state')!
      if (node.role === 'result') emptyState.innerHTML = '<span>▶</span><b>正在生成视频</b><small>完成后可在这里双击播放</small>'
      else {
        const references = links.filter(link => link.to === node.id).map(link => nodes.find(item => item.id === link.from)).filter((item): item is FlowNode => item?.kind === 'image' && Boolean(item.mediaUrl)).sort((left, right) => left.y - right.y || left.x - right.x || left.id - right.id)
        const referenceCount = references.length
        const mode = referenceCount > 1 ? '多图生视频' : referenceCount === 1 ? '图生视频' : '文生视频'
        const settings = node.videoSettings ?? {}
        const frames = references.map((reference, index) => `<i class="has-image" title="参考图 ${index + 1}"><canvas class="reference-image" width="180" height="120" data-reference-url="${escapeHtml(reference.mediaUrl!)}"></canvas><b>${index + 1}</b></i>`).join('')
        const placeholders = referenceCount ? '' : '<i><span>1</span></i><i><span>2</span></i><i><span>3</span></i>'
        emptyState.innerHTML = `<header class="video-node-heading"><div><b>视频生成</b><small>${mode}${referenceCount ? ` · ${referenceCount} 张参考图` : ''}</small></div></header><div class="video-storyboard" style="--frame-count:${referenceCount || 3}">${frames}${placeholders}<em>→</em></div><div class="video-node-summary"><em>${settings.seconds ?? '5'} 秒</em><em>${settings.resolution ?? '720p'}</em><em>${settings.aspectRatio ?? '16:9'}</em></div><p>${node.body.trim() ? escapeHtml(node.body.trim()) : referenceCount ? '参考图已就绪，在下方描述画面运动' : '连接图片，或直接输入视频描述'}</p>`
        emptyState.querySelectorAll<HTMLCanvasElement>('[data-reference-url]').forEach(canvas=>paintNodeMedia(canvas,canvas.dataset.referenceUrl!))
      }
    }
    element.querySelectorAll<HTMLElement>('[data-action]').forEach(button => button.hidden = false)
    for (const action of ['zoom-in', 'zoom-out']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = node.kind !== 'prompt'
    element.querySelector<HTMLElement>('[data-action="preview"]')!.hidden = !node.mediaUrl
    element.querySelector<HTMLElement>('[data-action="download"]')!.hidden = node.kind !== 'image' || !node.mediaUrl
    element.querySelector<HTMLElement>('[data-action="generate"]')!.hidden = node.kind === 'note' || node.kind === 'prompt'
    if (node.kind === 'image') for (const action of ['edit', 'zoom-in', 'zoom-out', 'generate', 'preview']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = true
    if (node.kind === 'video') for (const action of ['edit', 'zoom-in', 'zoom-out', 'generate', 'preview']) element.querySelector<HTMLElement>(`[data-action="${action}"]`)!.hidden = true
    if (node.kind === 'image' || node.kind === 'video') {
      element.querySelector<HTMLElement>('[data-action="info"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg><span>信息</span></span>'
      element.querySelector<HTMLElement>('[data-action="download"]')!.innerHTML = '<span class="node-tool-content"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg><span>下载</span></span>'
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
      const model = imagePanel.querySelector<HTMLSelectElement>('[data-image-field="model"]')!, description = imagePanel.querySelector<HTMLTextAreaElement>('[data-image-field="description"]')!
      if (document.activeElement !== model) model.value = node.model ?? 'gpt-image-2'; imagePanel.querySelector<HTMLElement>('[data-image-model-label]')!.textContent = modelDisplayName(node.model ?? 'gpt-image-2'); description.placeholder = node.mediaUrl ? '描述你想如何修改这张图片' : '描述要生成的图片内容'; if (document.activeElement !== description) description.value = node.body
      const originalPrompt = imagePanel.querySelector<HTMLElement>('.image-original-prompt')!; originalPrompt.classList.toggle('visible', Boolean(node.generationPrompt || node.mediaUrl)); originalPrompt.querySelector<HTMLElement>('p')!.textContent = node.generationPrompt || '导入图片，无生成提示词'
      for (const key of ['size', 'quality', 'background'] as const) { const input = imagePanel.querySelector<HTMLSelectElement>(`[data-image-field="${key}"]`)!; if (document.activeElement !== input) input.value = node.imageSettings?.[key] ?? 'auto' }
      imagePanel.querySelectorAll<HTMLElement>('[data-image-setting]').forEach(button => button.classList.toggle('active', node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] === button.dataset.value || ((!node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] || node.imageSettings?.[button.dataset.imageSetting as 'size' | 'quality' | 'background'] === 'auto') && button.dataset.value === 'auto')))
      const sizeLabel = ({ auto: '自动尺寸', '1024x1024': '1:1', '1344x1008': '4:3', '1008x1344': '3:4', '1536x1024': '3:2', '1024x1536': '2:3', '1536x864': '16:9', '864x1536': '9:16' } as Record<string, string>)[node.imageSettings?.size ?? 'auto'] ?? node.imageSettings?.size
      const qualityLabel = ({ auto: '自动质量', high: '高质量', medium: '标准质量', low: '低质量' } as Record<string, string>)[node.imageSettings?.quality ?? 'auto'] ?? node.imageSettings?.quality
      imagePanel.querySelector<HTMLElement>('[data-image-settings-label]')!.textContent = `${qualityLabel} · ${sizeLabel}`
      const generateButton = imagePanel.querySelector<HTMLButtonElement>('[data-image-generate]')!; generateButton.disabled = locked || !canGenerateNode(node); generateButton.classList.toggle('is-running', locked); generateButton.innerHTML = locked ? '<i aria-hidden="true"></i><b>生成中</b>' : '<span>▶</span><b>生成</b>'
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
    const progress = element.querySelector<HTMLElement>('.node-progress i')!, progressTrack = element.querySelector<HTMLElement>('.node-progress')!, waitingWithoutProgress = locked && (node.status === 'queued' || Number(node.progress ?? 0) <= 0); progress.style.width = waitingWithoutProgress ? '100%' : `${node.progress ?? 0}%`
    progressTrack.classList.toggle('visible', locked); progressTrack.classList.toggle('indeterminate', waitingWithoutProgress)
  }
}

function createDomNode(node: FlowNode) {
  const element = document.createElement('article'); element.dataset.id = String(node.id); element.className = 'flow-node'
  element.innerHTML = `<div class="node-floating-tools"><button data-action="info" title="信息">ⓘ</button><button data-action="edit" title="编辑">✎</button><button data-action="zoom-in" title="放大文字">＋</button><button data-action="zoom-out" title="缩小文字">−</button><button data-action="generate" title="生成">✦</button><button data-action="preview" title="预览">⌕</button><button data-action="download" title="下载图片">↓</button><button data-action="delete" title="删除">⌫</button></div><div class="node-info-popover"></div><div class="node-port input" data-side="left"></div><div class="node-port output" data-side="right"></div><span class="node-kind"></span><div class="node-media"><canvas class="node-media-canvas" width="560" height="440"></canvas></div><div class="image-empty-state"><span>▧</span><b>空图节点</b><small>连接参考图，或在下方描述要生成的图片</small></div><div class="node-copy"></div><div class="node-progress"><i></i></div><section class="image-config-panel"><div class="image-composer-title"><span>IMAGE</span><small>描述你想创造的画面</small></div><textarea data-image-field="description" rows="4" aria-label="图片描述" placeholder="例如：清晨薄雾中的未来城市，电影感光影…"></textarea><footer><details class="image-model-picker"><summary><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"></path></svg><b data-image-model-label>gpt-image-2</b><i>⌄</i></summary><div class="image-model-menu"><small>选择图像模型</small><button type="button" data-image-model="gpt-image-2"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg><span><b>gpt-image-2</b><small>OpenAI 图像生成</small></span><i>✓</i></button></div><select data-image-field="model" aria-label="模型" hidden><option value="gpt-image-2">gpt-image-2</option></select></details><details><summary><span>⚙</span><b data-image-settings-label>自动质量 · 自动尺寸</b><i>⌃</i></summary><div class="image-settings-popover"><header><span>图像设置</span><small>调整输出规格</small></header><label><span><b>质量</b><small>细节与生成速度</small></span><select data-image-field="quality"><option value="auto">自动质量</option><option value="high">高质量</option><option value="medium">标准质量</option><option value="low">低质量</option></select></label><label><span><b>画面尺寸</b><small>输出宽高比例</small></span><select data-image-field="size"><option value="auto">自动尺寸</option><option value="1024x1024">1:1 · 1024 × 1024</option><option value="1536x1024">3:2 · 1536 × 1024</option><option value="1024x1536">2:3 · 1024 × 1536</option></select></label><label><span><b>背景</b><small>画面底色模式</small></span><select data-image-field="background"><option value="auto">自动背景</option><option value="transparent">透明背景</option><option value="opaque">不透明背景</option></select></label></div></details><button data-image-generate type="button" title="开始生成" aria-label="生成"><span>↑</span></button></footer></section>`
  const mediaVideo = document.createElement('video'); mediaVideo.className = 'node-media-video'; mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'metadata'; mediaVideo.draggable = false; mediaVideo.hidden = true; element.querySelector('.node-media')!.append(mediaVideo)
  const zoomHint = document.createElement('span'); zoomHint.className = 'image-zoom-hint'; zoomHint.textContent = node.kind === 'video' ? '双击播放' : '双击放大'; element.querySelector('.node-media')!.append(zoomHint)
  const videoPanel = document.createElement('section'); videoPanel.className = 'video-config-panel'; videoPanel.innerHTML = `<header><span>VIDEO</span><small>描述画面内容、动作与镜头变化</small></header><textarea data-video-description rows="5" placeholder="例如：人物缓慢转身，镜头向前推进，柔和电影光影…"></textarea><footer><details class="video-model-picker"><summary><span>◈</span><b>视频模型</b></summary><div class="video-model-popover"><small>模型名称</small><input data-video-model value="Kling 2.1" aria-label="视频模型"></div></details><details class="video-settings-picker"><summary><span>⚙</span><b>视频属性</b></summary><div class="video-settings-popover"><header><b>视频设置</b><small>调整输出规格</small></header><div class="video-setting-row"><b>时长</b><div class="video-seconds-stepper"><button data-seconds-step="-1" type="button" aria-label="减少一秒">−</button><output data-video-seconds>5 秒</output><button data-seconds-step="1" type="button" aria-label="增加一秒">＋</button></div></div><div class="video-setting-row"><b>分辨率</b><div class="video-pill-grid"><button data-video-setting="resolution" data-value="480p" type="button">480p</button><button data-video-setting="resolution" data-value="720p" type="button">720p</button><button data-video-setting="resolution" data-value="1080p" type="button">1080p</button></div></div><div class="video-setting-row"><b>比例</b><div class="video-ratio-grid"><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="1:1" type="button"><i style="--ratio:1"></i><span>方形</span><small>1:1</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="4:3" type="button"><i style="--ratio:1.333"></i><span>横向</span><small>4:3</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="16:9" type="button"><i style="--ratio:1.778"></i><span>宽屏</span><small>16:9</small></button></div></div></div></details><button data-video-generate type="button"><span>▶</span><b>生成</b></button></footer>`; element.append(videoPanel)
  const videoResultPrompt = document.createElement('section'); videoResultPrompt.className = 'video-result-prompt'; videoResultPrompt.innerHTML = '<header><span>原提示词</span><small>点击复制</small></header><p role="button" tabindex="0" title="点击复制原提示词"></p>'; element.append(videoResultPrompt)
  videoResultPrompt.addEventListener('mousedown', event => event.stopPropagation()); videoResultPrompt.addEventListener('click', event => event.stopPropagation())
  const videoPromptText = videoResultPrompt.querySelector<HTMLElement>('p')!
  videoPromptText.addEventListener('click', () => void copyOriginalPrompt(node.generationPrompt))
  videoPromptText.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copyOriginalPrompt(node.generationPrompt) } })
  const videoModelPopover = videoPanel.querySelector<HTMLElement>('.video-model-popover')!, grokEnabled = Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0) >= 2; videoModelPopover.innerHTML = `<small>选择视频模型</small><button type="button" data-video-model-option="agnes-video-v2.0"><span><b>Agnes Video 2.0</b><small>Agnes 专用视频接口</small></span><em class="model-price free">免费</em><i>✓</i></button><button type="button" class="${grokEnabled ? '' : 'model-unavailable'}" data-video-model-option="grok-imagine-video-1.5-preview" ${grokEnabled ? '' : 'disabled'}><span><b>Grok Imagine Video 1.5 Preview</b><small>${grokEnabled ? '付费视频模型' : '创作点数不足'}</small></span><em class="model-price ${grokEnabled ? 'paid' : 'locked'}">×2</em><i>${grokEnabled ? '✓' : '⌁'}</i></button><input type="hidden" data-video-model value="agnes-video-v2.0">`
  for (const item of customApiModels.filter(item => item.kind === 'video')) videoModelPopover.querySelector('input')!.insertAdjacentHTML('beforebegin', `<button type="button" data-video-model-option="custom:${item.id}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><em class="model-price paid">自定义</em><i>✓</i></button>`)
  const videoCount = document.createElement('span'); videoCount.className = 'video-generation-count'; element.append(videoCount)
  const videoResultModel = document.createElement('span'); videoResultModel.className = 'video-result-model'; element.append(videoResultModel)
  element.querySelector('.image-config-panel')!.classList.add('image-composer-v2')
  const imageModelMenu = element.querySelector<HTMLElement>('.image-model-menu')!, imageModelSelect = element.querySelector<HTMLSelectElement>('[data-image-field="model"]')!
  const grokImageEnabled = Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0) >= 1
  imageModelMenu.insertAdjacentHTML('beforeend', `<button type="button" class="${grokImageEnabled ? '' : 'model-unavailable'}" data-image-model="grok-imagine-image" ${grokImageEnabled ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"></path></svg><span><b>Grok Imagine Image</b><small>${grokImageEnabled ? 'Grok 图像生成' : '创作点数不足'}</small></span><em class="model-price ${grokImageEnabled ? 'paid' : 'locked'}">×1</em><i>${grokImageEnabled ? '✓' : '⌁'}</i></button>`)
  imageModelSelect.insertAdjacentHTML('beforeend', '<option value="grok-imagine-image">Grok Imagine Image</option>')
  imageModelMenu.insertAdjacentHTML('beforeend', '<button type="button" class="model-unavailable" data-image-model="gemini-3.1-flash-image" disabled><svg viewBox="0 0 24 24"><path d="M12 2c1.4 5.2 4.8 8.6 10 10-5.2 1.4-8.6 4.8-10 10-1.4-5.2-4.8-8.6-10-10 5.2-1.4 8.6-4.8 10-10Z"></path></svg><span><b>Gemini 3.1 Flash Image</b><small>CPA 图片接口适配中</small></span><em class="model-price locked">实验性</em><i>⌁</i></button>')
  imageModelSelect.insertAdjacentHTML('beforeend', '<option value="gemini-3.1-flash-image" disabled>Gemini 3.1 Flash Image · 实验性</option>')
  for (const item of customApiModels.filter(item => item.kind === 'image')) { imageModelMenu.insertAdjacentHTML('beforeend', `<button type="button" data-image-model="custom:${item.id}"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 12h8"></path></svg><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><i>✓</i></button>`); imageModelSelect.insertAdjacentHTML('beforeend', `<option value="custom:${item.id}">${escapeHtml(item.name)}</option>`) }
  const originalPrompt = document.createElement('div'); originalPrompt.className = 'image-original-prompt'; originalPrompt.innerHTML = '<span>原提示词 <small>点击复制</small></span><p role="button" tabindex="0" title="点击复制原提示词"></p>'; element.querySelector('.image-config-panel textarea')!.before(originalPrompt)
  const imagePromptText = originalPrompt.querySelector<HTMLElement>('p')!
  imagePromptText.addEventListener('click', () => void copyOriginalPrompt(node.generationPrompt))
  imagePromptText.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copyOriginalPrompt(node.generationPrompt) } })
  element.querySelectorAll('.image-model-picker > summary > i,.image-config-panel footer > details:not(.image-model-picker) > summary > i').forEach(icon => icon.remove())
  element.querySelector<HTMLElement>('.image-settings-popover')!.innerHTML = `<header><span>图像设置</span><small>调整输出质量与画面比例</small></header><section class="image-setting-section"><b>质量</b><div class="image-quality-options"><button type="button" data-image-setting="quality" data-value="auto">自动</button><button type="button" data-image-setting="quality" data-value="high">高</button><button type="button" data-image-setting="quality" data-value="medium">中</button><button type="button" data-image-setting="quality" data-value="low">低</button></div><select data-image-field="quality" hidden><option value="auto">自动</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></section><section class="image-setting-section"><b>尺寸 <small>可直接输入自定义宽高</small></b><div class="image-dimension-inputs"><label><span>W</span><input type="number" min="1" max="3840" placeholder="自动" data-image-width></label><i>×</i><label><span>H</span><input type="number" min="1" max="3840" placeholder="自动" data-image-height></label></div></section><section class="image-setting-section"><b>长宽比</b><div class="image-aspect-options"><button type="button" data-image-setting="size" data-value="auto"><i class="aspect-auto">A</i><span>自动</span></button><button type="button" data-image-setting="size" data-value="1024x1024"><i class="aspect-square"></i><span>1:1</span></button><button type="button" data-image-setting="size" data-value="1344x1008"><i class="aspect-4-3"></i><span>4:3</span></button><button type="button" data-image-setting="size" data-value="1008x1344"><i class="aspect-3-4"></i><span>3:4</span></button><button type="button" data-image-setting="size" data-value="1536x1024"><i class="aspect-landscape"></i><span>3:2</span></button><button type="button" data-image-setting="size" data-value="1024x1536"><i class="aspect-portrait"></i><span>2:3</span></button><button type="button" data-image-setting="size" data-value="1536x864"><i class="aspect-16-9"></i><span>16:9</span></button><button type="button" data-image-setting="size" data-value="864x1536"><i class="aspect-9-16"></i><span>9:16</span></button><button type="button" data-custom-size><i class="aspect-auto">✎</i><span>自定义</span></button></div><select data-image-field="size" hidden><option value="auto">自动</option><option value="1024x1024">1:1</option><option value="1344x1008">4:3</option><option value="1008x1344">3:4</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option><option value="1536x864">16:9</option><option value="864x1536">9:16</option></select><p class="image-size-notice">尺寸设置可能因接口兼容性不生效，可在提示词中同时指定画面比例。</p></section><section class="image-setting-section image-background-setting"><span><b>透明背景</b><small>仅部分模型支持</small></span><button type="button" data-image-setting="background" data-value="transparent" aria-label="透明背景"><i></i></button><select data-image-field="background" hidden><option value="auto">自动</option><option value="transparent">透明</option><option value="opaque">不透明</option></select></section>`
  const settingsPopover = element.querySelector<HTMLElement>('.image-settings-popover')!; settingsPopover.querySelector('[data-image-width]')?.closest('.image-setting-section')?.remove(); settingsPopover.querySelector('[data-custom-size]')?.remove(); settingsPopover.querySelector('header small')!.textContent = '常用画面比例与输出规格'
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || domDrag) return
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,select,details,.node-port,.image-config-panel,.video-config-panel,.node-floating-tools') || target.closest('.node-copy[contenteditable="true"]')) return
    if(promptAgentSelecting){event.preventDefault();event.stopPropagation();element.setPointerCapture(event.pointerId);domDrag={id:node.id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,initialX:node.x,initialY:node.y,element,moved:false,agentSelect:true};element.classList.add('dragging');return}
    event.preventDefault(); event.stopPropagation(); selectedId = node.id; updateEditor()
    if (node.status === 'queued' || node.status === 'running') { draw(); return }
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
  element.querySelectorAll<HTMLElement>('.node-port').forEach(port => port.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); selectedId = 0; updateEditor(); connectionSnap = null; connecting = { nodeId: node.id, side: port.dataset.side as PortSide, pointer: { x: event.clientX, y: event.clientY } }; draw() }))
  element.querySelector('[data-action="info"]')!.addEventListener('click', event => { event.stopPropagation(); openNodeInfo(node) })
  element.querySelector('[data-action="edit"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); if (node.kind === 'prompt') enterTextEdit(node, element); else promptInput.focus() })
  element.querySelector('[data-action="zoom-in"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.min(2, (node.fontScale ?? 1) + .1); scheduleSave(); draw() })
  element.querySelector('[data-action="zoom-out"]')!.addEventListener('click', event => { event.stopPropagation(); node.fontScale = Math.max(.7, (node.fontScale ?? 1) - .1); scheduleSave(); draw() })
  element.querySelector('[data-action="generate"]')!.addEventListener('click', event => { event.stopPropagation(); selectedId = node.id; updateEditor(); void generate() })
  element.querySelector('[data-action="preview"]')!.addEventListener('click', event => { event.stopPropagation(); if (node.mediaUrl) openAssetPreview(node.mediaUrl, node.title) })
  element.querySelector('[data-action="download"]')!.addEventListener('click', event => { event.stopPropagation(); if (node.mediaUrl) void downloadNodeImage(node) })
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
  return { id: node.publicId, type: node.kind === 'prompt' ? 'label' : node.kind, title: node.kind === 'prompt' ? '标签' : node.title, position: { x: node.x, y: node.y }, width: node.width, height: node.height, metadata: { content: node.body, status: node.status ?? 'idle', fontSize: Math.round(12 * (node.fontScale ?? 1)) } }
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
function paintNodeVideo(target:HTMLCanvasElement,url:string){
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='metadata';video.crossOrigin='anonymous'
  const dispose=()=>{video.pause();video.removeAttribute('src');video.load()}
  const paint=()=>{try{const context=target.getContext('2d')!,scale=Math.min(target.width/video.videoWidth,target.height/video.videoHeight),width=video.videoWidth*scale,height=video.videoHeight*scale;context.fillStyle='#11181a';context.fillRect(0,0,target.width,target.height);context.drawImage(video,(target.width-width)/2,(target.height-height)/2,width,height)}catch{/* preview remains dark when the provider blocks frame extraction */}dispose()}
  video.addEventListener('loadeddata',()=>{if(video.duration>.08){video.currentTime=.05}else paint()},{once:true});video.addEventListener('seeked',paint,{once:true});video.addEventListener('error',dispose,{once:true});video.src=url
}
function repaintMediaUrl(url: string) { const image = imageCache.get(mediaThumbnailUrl(url)); if (!image) return; nodes.filter(node => node.mediaUrl === url).forEach(node => { const target = nodeLayer.querySelector<HTMLCanvasElement>(`.flow-node[data-id="${node.id}"] .node-media-canvas`); if (target) drawMediaImage(target, image!) }) }
function repaintAllMedia() { nodes.filter(node => node.mediaUrl).forEach(node => repaintMediaUrl(node.mediaUrl!)) }

window.addEventListener('pointermove', event => {
  if (domResize) { const node = nodes.find(item => item.id === domResize!.id); if (!node) return; const width = Math.max(220, domResize.width + (event.clientX - domResize.startX) / camera.zoom); let height = Math.max(160, domResize.height + (event.clientY - domResize.startY) / camera.zoom); if (node.mediaUrl && !event.shiftKey) height = Math.max(180, domResize.height * width / domResize.width); node.width = width; node.height = height; setSaveState('editing', '编辑中…'); draw() }
  if (connecting) { updateConnectionPointer(event.clientX, event.clientY); draw() }
})
window.addEventListener('pointerup', event => {
  if (domResize) { domResize = null; scheduleSave() }
  if (!connecting) return
  const snappedNode = connectionSnap ? nodes.find(node => node.id === connectionSnap!.nodeId) : undefined; const target = snappedNode ? { node: snappedNode, side: connectionSnap!.side } : hitPort(event.clientX, event.clientY, 32, connecting.nodeId)
  if (target) { const next = connecting.side === 'left' ? { from: target.node.id, to: connecting.nodeId, fromSide: target.side, toSide: connecting.side } : { from: connecting.nodeId, to: target.node.id, fromSide: connecting.side, toSide: target.side }; if (!links.some(link => link.from === next.from && link.to === next.to)) links.push(next); scheduleSave() }
  connecting = null; connectionSnap = null; draw()
})
window.addEventListener('pointermove', event => {
  if (!domDrag || event.pointerId !== domDrag.pointerId) return
  // Edge can report a final mousemove with buttons=0 before mouseup. Keep the
  // release guarded here too, otherwise its synthetic drop/click may navigate
  // to the image URL after a node drag.
  if (event.buttons === 0) {
    if (domDrag.moved) suppressNodeReleaseUntil = performance.now() + 700
    domDrag.element.classList.remove('dragging'); domDrag = null
    if (domDragFrame !== null) cancelAnimationFrame(domDragFrame); domDragFrame = null
    scheduleSave(); draw(); return
  }
  const drag = domDrag, dx = (event.clientX - drag.startX) / camera.zoom, dy = (event.clientY - drag.startY) / camera.zoom
  if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.moved = true
  if (domDragFrame !== null) cancelAnimationFrame(domDragFrame)
  domDragFrame = requestAnimationFrame(() => { const node = nodes.find(item => item.id === drag.id); if (node) { node.x = drag.initialX + dx; node.y = drag.initialY + dy; setSaveState('editing', '编辑中…'); draw() } domDragFrame = null })
})
window.addEventListener('pointerup', event => {
  if (!domDrag || event.pointerId !== domDrag.pointerId || event.button !== 0) return
  if (domDragFrame !== null) { cancelAnimationFrame(domDragFrame); domDragFrame = null }
  const drag = domDrag, node = nodes.find(item => item.id === drag.id)
  if (node && drag.moved) { node.x = drag.initialX + (event.clientX - drag.startX) / camera.zoom; node.y = drag.initialY + (event.clientY - drag.startY) / camera.zoom }
      if(drag.agentSelect&&!drag.moved){if(promptAgentContextSelection.has(drag.id))promptAgentContextSelection.delete(drag.id);else if(promptAgentContextSelection.size<8)promptAgentContextSelection.add(drag.id);else showToast('参考素材最多选择 8 个','warning');renderPromptAgentContext(false)}
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
  const deletedId = nodes[index].id
  nodes.splice(index, 1)
  for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--) {
    if (links[linkIndex].from === deletedId || links[linkIndex].to === deletedId) links.splice(linkIndex, 1)
  }
  selectedId = 0
  updateEditor(); scheduleSave(); draw()
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
    nodes.splice(0, nodes.length, ...(document.nodes ?? [])); nodes.forEach(node => { if (node.kind === 'prompt' && node.title === '文本') node.title = '标签'; if (node.kind === 'prompt' && node.body === '输入你的创意描述') node.body = '记录标签、分组标题或画布备注'; if ((node.kind === 'image' || node.kind === 'video') && !node.mediaUrl && node.body === '等待配置模型与生成参数') node.body = ''; if (node.kind === 'video') node.videoSettings = { seconds: '5', resolution: '720p', aspectRatio: '16:9', ...(node.videoSettings ?? {}) }; if (node.kind === 'video' && node.role !== 'result') { node.status = 'idle'; node.progress = 0; delete node.jobId } if (node.imageSettings?.size && !['auto', '1024x1024', '1344x1008', '1008x1344', '1536x1024', '1024x1536', '1536x864', '864x1536'].includes(node.imageSettings.size)) node.imageSettings.size = 'auto' }); await Promise.all(nodes.filter(node => node.jobId && (!node.generationPrompt || node.body === '生成完成 · 结果已回写')).map(async node => { try { const jobResponse = await fetch(`/api/jobs/${node.jobId}`); if (!jobResponse.ok) return; const job = await jobResponse.json() as { prompt?: string }; if (job.prompt) { node.generationPrompt = job.prompt; if (node.body === '生成完成 · 结果已回写' || node.body === job.prompt) node.body = '' } } catch { /* 保留现有内容，等待用户手动修正 */ } })); const migrated = (document.links ?? []).map(link => Array.isArray(link) ? { from: link[0], to: link[1], fromSide: 'right' as PortSide, toSide: 'left' as PortSide } : link); links.splice(0, links.length, ...migrated); nextId = nodes.length ? Math.max(...nodes.map(node => node.id)) + 1 : 1
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
    const inputUrls = source.kind === 'video'
      ? upstream.filter(item => item.kind === 'image').map(item => item.mediaUrl).filter((url): url is string => Boolean(url))
      : [...new Set([...(source.mediaUrl ? [source.mediaUrl] : []), ...upstream.map(item => item.mediaUrl).filter((url): url is string => Boolean(url))])]
    const resolvedPrompt = source.body.trim()
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
function runAgentWorkflow(){for(const node of nodes.filter(item=>item.agentAuto&&!agentWorkflowSubmitting.has(item.id))){const upstream=links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).filter((item):item is FlowNode=>Boolean(item));if(upstream.some(item=>item.status==='failed')){node.agentAuto=false;node.status='failed';showToast(`${node.title} 的上游步骤失败，工作流已停止`,'error');continue}if(upstream.some(item=>item.kind==='image'&&!item.mediaUrl))continue;agentWorkflowSubmitting.add(node.id);if(node.kind!=='video'||node.role==='result')node.status='queued';void generate(node).finally(()=>{agentWorkflowSubmitting.delete(node.id);scheduleSave();draw()})}}

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

canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; if (cameraFrame !== null) { cancelAnimationFrame(cameraFrame); cameraFrame = null; zoomTarget = camera.zoom } pointer.down = true; pointer.x = e.clientX; pointer.y = e.clientY; const port = hitPort(e.clientX, e.clientY); if (port) { connectionSnap = null; connecting = { nodeId: port.node.id, side: port.side, pointer: { x: e.clientX, y: e.clientY } }; selectedId = 0; pointer.draggingNode = null; updateEditor() } else { const node = hitNode(e.clientX, e.clientY); pointer.draggingNode = node && node.status !== 'queued' && node.status !== 'running' ? node.id : null; if (node) selectedId = node.id; else selectedId = 0; updateEditor() } canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); draw() })
canvas.addEventListener('pointermove', e => { if (!pointer.down) return; setSaveState('editing', '编辑中…'); if (connecting) { updateConnectionPointer(e.clientX, e.clientY); draw(); return } const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (pointer.draggingNode) { const node = nodes.find(n => n.id === pointer.draggingNode)!; node.x += dx / camera.zoom; node.y += dy / camera.zoom } else { camera.x += dx; camera.y += dy } pointer.x = e.clientX; pointer.y = e.clientY; draw() })
canvas.addEventListener('pointerup', e => { if (connecting) { const snappedNode = connectionSnap ? nodes.find(node => node.id === connectionSnap!.nodeId) : undefined, target = snappedNode ? { node: snappedNode, side: connectionSnap!.side } : hitPort(e.clientX, e.clientY, 32, connecting.nodeId); if (target) { const duplicate = links.some(link => link.from === connecting!.nodeId && link.to === target.node.id && link.fromSide === connecting!.side && link.toSide === target.side); if (!duplicate) links.push({ from: connecting.nodeId, to: target.node.id, fromSide: connecting.side, toSide: target.side }) } connecting = null; connectionSnap = null } scheduleSave(); pointer.down = false; pointer.draggingNode = null; canvas.classList.remove('dragging'); draw() })
canvas.addEventListener('wheel', e => { e.preventDefault(); closeQuickNodeMenu(); smoothZoom(zoomTarget * Math.exp(-e.deltaY * .001), { x: e.clientX, y: e.clientY }) }, { passive: false })
nodeLayer.addEventListener('wheel', e => {
  const target = e.target as HTMLElement | null
  if (target?.closest('textarea,input,select,[contenteditable="true"],.node-copy,.image-original-prompt p')) return
  e.preventDefault(); e.stopPropagation(); closeQuickNodeMenu(); smoothZoom(zoomTarget * Math.exp(-e.deltaY * .001), { x: e.clientX, y: e.clientY })
}, { passive: false })
const linkHoverHint = document.querySelector<HTMLElement>('#link-hover-hint')!
canvas.addEventListener('pointermove', event => { if (pointer.down || connecting) return; const index = hitLink(event.clientX, event.clientY); if (index !== hoveredLinkIndex) { hoveredLinkIndex = index; draw() } linkHoverHint.classList.toggle('open', index >= 0); if (index >= 0) { const generating = canvasHasActiveGeneration(); linkHoverHint.classList.toggle('locked', generating); linkHoverHint.textContent = generating ? '画布生成中 · 连线已锁定' : '右键 · 删除连线'; linkHoverHint.style.left = `${event.clientX + 14}px`; linkHoverHint.style.top = `${event.clientY + 14}px`; canvas.style.cursor = 'pointer' } else canvas.style.removeProperty('cursor') })
canvas.addEventListener('pointerleave', () => { if (hoveredLinkIndex >= 0) { hoveredLinkIndex = -1; draw() } linkHoverHint.classList.remove('open'); canvas.style.removeProperty('cursor') })
canvas.addEventListener('contextmenu', event => { event.preventDefault(); const index = hitLink(event.clientX, event.clientY); if (index < 0) return; if (canvasHasActiveGeneration()) { showToast('画布正在生成，任务完成后即可删除连线', 'warning'); return } links.splice(index, 1); hoveredLinkIndex = -1; linkHoverHint.classList.remove('open'); scheduleSave(); draw() })
document.querySelector('#reset')!.addEventListener('click', fitCanvas)
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
  quickNodePosition = world({ x: event.clientX, y: event.clientY })
  quickNodeMenu.style.left = `${Math.max(12, Math.min(event.clientX + 12, innerWidth - 310))}px`
  quickNodeMenu.style.top = `${Math.max(12, Math.min(event.clientY + 12, innerHeight - 350))}px`
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
const appearanceButton = document.querySelector<HTMLButtonElement>('#dock-appearance')!
let themeTransitioning = false
function refreshAppearanceButton() { appearanceButton.disabled = themeTransitioning || pendingMediaLoads.size > 0; appearanceButton.title = pendingMediaLoads.size ? `等待 ${pendingMediaLoads.size} 个图片资源加载完成` : '切换画布外观' }
appearanceButton.addEventListener('click',()=>{
  if(themeTransitioning||appearanceButton.disabled)return
  themeTransitioning=true;refreshAppearanceButton();document.body.classList.add('theme-click-fade')
  window.setTimeout(()=>{colorTheme=colorTheme==='dark'?'light':'dark';document.body.dataset.theme=colorTheme;localStorage.setItem('flow-theme',colorTheme);repaintAllMedia();paint();document.body.classList.add('theme-click-return');document.body.classList.remove('theme-click-fade')},90)
  window.setTimeout(()=>{document.body.classList.remove('theme-click-return');themeTransitioning=false;refreshAppearanceButton()},260)
})
type PromptAgentStep = { title?:string; kind:'image'|'video'; prompt:string; referenceIndexes?:number[]; dependsOn?:number[] }
type PromptAgentResult = { model:string; kind:'image'|'video'; subject:string; scene:string; composition:string; lighting:string; style:string; motion:string; negativePrompt:string; finalPrompt:string; action?:'update_current'|'create_child'|'create_new'; targetType?:'image'|'video'; summary?:string; shouldGenerate?:boolean; steps?:PromptAgentStep[] }
const promptAgentTrigger=document.querySelector<HTMLButtonElement>('#prompt-agent-trigger')!,promptAgentPanel=document.createElement('section')
promptAgentPanel.className='prompt-agent-panel agent-capsule';promptAgentPanel.innerHTML=`<aside class="agent-selection-hint" aria-live="polite"><i>◇</i><span>点击卡片选择素材</span><em></em><kbd>右击</kbd><small>退出</small></aside><section class="agent-context"><div data-agent-context-list></div></section><label class="agent-goal"><textarea rows="1" placeholder="告诉我你想创造什么…" aria-label="创作需求"></textarea></label><button class="agent-submit" type="button" aria-label="开始创作"><span>✦</span><b>开始创作</b></button><output class="agent-status" hidden></output><article hidden><div class="agent-result-meta"><span>执行结果</span><small></small></div><strong data-agent-summary></strong><details><summary>查看提示词</summary><p data-agent-prompt></p></details><footer><button type="button" data-agent-undo hidden>撤销</button><button type="button" data-agent-copy>复制</button><button type="button" data-agent-locate>定位</button></footer></article>`;document.body.append(promptAgentPanel)
const promptAgentModelSelect=document.createElement('select');promptAgentModelSelect.hidden=true;promptAgentModelSelect.innerHTML='<option value="gpt-5.5" selected>gpt-5.5</option>';promptAgentPanel.append(promptAgentModelSelect)
const promptAgentEffects=document.createElement('canvas'),promptAgentEffectsFront=document.createElement('canvas');promptAgentEffects.className='agent-capsule-effects';promptAgentEffectsFront.className='agent-capsule-effects front';document.body.append(promptAgentEffects,promptAgentEffectsFront)
const promptAgentRibbonBack=document.createElement('div'),promptAgentRibbonFront=document.createElement('div');promptAgentRibbonBack.className='agent-capsule-ribbon back';promptAgentRibbonFront.className='agent-capsule-ribbon front';promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-back" x1="0" y1="0" x2="720" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="#80ddd4" stop-opacity="0"/><stop offset=".28" stop-color="#74d8d0" stop-opacity=".5"/><stop offset=".68" stop-color="#829ee0" stop-opacity=".38"/><stop offset="1" stop-color="#829ee0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-blur"><feGaussianBlur stdDeviation="1.7"/></filter></defs><path d="M-42 118C92 12 188 151 318 73C431 5 527 150 762 46" fill="none" stroke="url(#agent-ribbon-back)" stroke-width="15" stroke-linecap="round" filter="url(#agent-ribbon-blur)"/></svg>`;promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-front" x1="0" y1="180" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#819de2" stop-opacity="0"/><stop offset=".32" stop-color="#8ba9e8" stop-opacity=".36"/><stop offset=".64" stop-color="#8de7da" stop-opacity=".55"/><stop offset="1" stop-color="#8de7da" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-blur"><feGaussianBlur stdDeviation="1.25"/></filter></defs><path d="M-35 42C123 151 226 23 356 111C484 198 575 22 755 126" fill="none" stroke="url(#agent-ribbon-front)" stroke-width="9" stroke-linecap="round" filter="url(#agent-ribbon-front-blur)"/></svg>`;document.body.append(promptAgentRibbonBack,promptAgentRibbonFront)
promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-back" x1="0" y1="20" x2="720" y2="160" gradientUnits="userSpaceOnUse"><stop stop-color="#75ddd3" stop-opacity="0"/><stop offset=".2" stop-color="#72d9d0" stop-opacity=".48"/><stop offset=".53" stop-color="#94e7dd" stop-opacity=".34"/><stop offset=".8" stop-color="#809de0" stop-opacity=".4"/><stop offset="1" stop-color="#809de0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-surface-soft"><feGaussianBlur stdDeviation="1.1"/></filter></defs><path fill="url(#agent-ribbon-surface-back)" filter="url(#agent-ribbon-surface-soft)" d="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"><animate attributeName="d" dur="7.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.34;.68;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z;M-45 126C82 34 173 133 304 59C430-12 557 158 765 55L765 91C550 177 453 38 329 91C196 164 65 65-45 153Z;M-45 102C61 8 194 165 326 82C451 3 535 129 765 35L765 63C570 155 438 17 314 116C176 197 83 39-45 134Z;M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"/></path></svg>`
promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-front" x1="0" y1="170" x2="720" y2="10" gradientUnits="userSpaceOnUse"><stop stop-color="#829fe3" stop-opacity="0"/><stop offset=".24" stop-color="#8ca8e7" stop-opacity=".36"/><stop offset=".58" stop-color="#9be9df" stop-opacity=".5"/><stop offset=".84" stop-color="#78dcd2" stop-opacity=".42"/><stop offset="1" stop-color="#78dcd2" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-soft"><feGaussianBlur stdDeviation=".8"/></filter></defs><path fill="url(#agent-ribbon-surface-front)" filter="url(#agent-ribbon-front-soft)" d="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"><animate attributeName="d" dur="9.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.38;.72;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z;M-40 48C125 159 207 7 341 92C469 174 590 31 760 132L760 157C585 68 471 198 360 119C224 30 103 187-40 78Z;M-40 24C98 127 231 32 366 116C495 196 563 5 760 105L760 134C563 39 497 220 337 140C201 62 132 154-40 51Z;M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"/></path></svg>`
promptAgentRibbonBack.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-back" x1="0" y1="20" x2="720" y2="130" gradientUnits="userSpaceOnUse"><stop stop-color="#72d8cf" stop-opacity="0"/><stop offset=".18" stop-color="#7cddd4" stop-opacity=".34"/><stop offset=".46" stop-color="#b5f3e9" stop-opacity=".42"/><stop offset=".72" stop-color="#91a9e7" stop-opacity=".3"/><stop offset="1" stop-color="#849fe2" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-shine" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".34"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#557fc8" stop-opacity=".12"/></linearGradient><filter id="agent-silk-soft"><feGaussianBlur stdDeviation=".65"/></filter></defs><path fill="url(#agent-silk-back)" filter="url(#agent-silk-soft)" d="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"><animate attributeName="d" dur="10.5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".42 0 .58 1;.42 0 .58 1" values="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z;M-35 109C78 26 205 38 353 33C508 28 635 25 755 99L755 120C628 51 511 55 358 61C203 67 81 48-35 131Z;M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"/></path><path fill="url(#agent-silk-shine)" opacity=".42" d="M-20 104C101 31 220 42 357 45C505 48 626 30 741 96L741 101C625 41 501 56 357 53C215 50 101 40-20 114Z"/></svg>`
promptAgentRibbonFront.innerHTML=`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-front-left" x1="0" y1="0" x2="240" y2="120" gradientUnits="userSpaceOnUse"><stop stop-color="#7edfd5" stop-opacity="0"/><stop offset=".48" stop-color="#a4eee4" stop-opacity=".58"/><stop offset="1" stop-color="#8ca9e8" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-front-right" x1="470" y1="30" x2="720" y2="150" gradientUnits="userSpaceOnUse"><stop stop-color="#8ca7e7" stop-opacity="0"/><stop offset=".48" stop-color="#9feadf" stop-opacity=".52"/><stop offset="1" stop-color="#79dcd2" stop-opacity="0"/></linearGradient><filter id="agent-silk-front-soft"><feGaussianBlur stdDeviation=".45"/></filter></defs><path fill="url(#agent-silk-front-left)" filter="url(#agent-silk-front-soft)" d="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"><animate attributeName="d" dur="9.8s" repeatCount="indefinite" values="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z;M-25 116C51 142 119 140 220 127L231 148C126 163 48 158-25 132Z;M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"/></path><path fill="url(#agent-silk-front-right)" filter="url(#agent-silk-front-soft)" d="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"><animate attributeName="d" dur="11.2s" repeatCount="indefinite" values="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z;M476 46C579 29 665 54 755 106L755 126C654 70 575 56 470 67Z;M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"/></path></svg>`
const physicalAgentRibbon=(id:string,front:boolean)=>`<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="${id}-fabric" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#496f78"/><stop offset=".12" stop-color="#759ca4"/><stop offset=".3" stop-color="#b9d4d2"/><stop offset=".47" stop-color="#739ca2"/><stop offset=".7" stop-color="#9bbbc0"/><stop offset=".9" stop-color="#526f82"/><stop offset="1" stop-color="#354c60"/></linearGradient><linearGradient id="${id}-fade" x1="0" y1="0" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".13" stop-color="#fff" stop-opacity="1"/><stop offset=".87" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${id}-end-fade"><rect width="720" height="180" fill="url(#${id}-fade)"/></mask>${front?`<clipPath id="${id}-front"><rect x="0" y="0" width="178" height="180"/><rect x="548" y="0" width="172" height="180"/></clipPath>`:''}</defs><g mask="url(#${id}-end-fade)" ${front?`clip-path="url(#${id}-front)"`:''}><path class="physical-ribbon-body" fill="url(#${id}-fabric)" d="M-42 112C74 18 190 157 326 68C450-13 557 151 762 48L762 80C564 178 455 20 333 101C195 190 82 55-42 147Z"/><path class="physical-ribbon-fold light" d="M-30 114C86 33 194 153 327 77C451 6 556 155 750 62"/><path class="physical-ribbon-fold shade" d="M-28 136C91 67 196 176 332 92C458 14 560 168 748 73"/></g></svg>`
promptAgentRibbonBack.innerHTML=physicalAgentRibbon('physical-agent-back',false);promptAgentRibbonFront.innerHTML=physicalAgentRibbon('physical-agent-front',true)
const promptAgentBurst=document.createElement('div');promptAgentBurst.className='agent-particle-burst';promptAgentBurst.innerHTML=Array.from({length:56},()=>'<i></i>').join('');document.body.append(promptAgentBurst)
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
function dispersePromptAgent(){if(!promptAgentPanel.classList.contains('open')||promptAgentPanel.classList.contains('gathering'))return;promptAgentPanel.classList.add('gathering');const panelRect=promptAgentPanel.getBoundingClientRect(),target={x:panelRect.left+panelRect.width/2,y:panelRect.top+panelRect.height/2},materials=[...promptAgentPanel.querySelectorAll<HTMLElement>('[data-agent-context-node]')];materials.forEach((material,index)=>{const rect=material.getBoundingClientRect();material.style.setProperty('--gather-x',`${target.x-(rect.left+rect.width/2)}px`);material.style.setProperty('--gather-y',`${target.y-(rect.top+rect.height/2)}px`);material.style.setProperty('--gather-delay',`${index*18}ms`);material.classList.add('is-gathering')});window.setTimeout(()=>{const field=document.createElement('div');field.className='agent-disperse-field';field.style.left=`${panelRect.left}px`;field.style.top=`${panelRect.top}px`;field.style.width=`${panelRect.width}px`;field.style.height=`${panelRect.height}px`;field.innerHTML=Array.from({length:82},(_,index)=>{const column=(index*37)%100,row=(index*61)%100,angle=index*2.399963,distance=28+(index%11)*5,dx=Math.cos(angle)*distance,dy=Math.sin(angle)*distance*.72,size=2+(index%4);return `<i style="left:${column}%;top:${row}%;width:${size}px;height:${size}px;--scatter-x:${dx}px;--scatter-y:${dy}px;--particle-delay:${(index%9)*8}ms"></i>`}).join('');document.body.append(field);promptAgentPanel.classList.add('dispersing');requestAnimationFrame(()=>field.classList.add('active'));window.setTimeout(()=>{field.remove();promptAgentPanel.classList.remove('gathering','dispersing');materials.forEach(material=>material.classList.remove('is-gathering'));closePromptAgent()},680)},Math.max(190,materials.length*18+150))}
function playAgentMeteor(){const node=nodes.find(item=>item.id===promptAgentAppliedNodeId);if(!node)return;const panel=promptAgentPanel.getBoundingClientRect(),start={x:panel.left+panel.width*.25,y:panel.top+panel.height*.45},end={x:innerWidth/2+camera.x+(node.x+node.width/2)*camera.zoom,y:innerHeight/2+camera.y+(node.y+node.height/2)*camera.zoom},dx=end.x-start.x,dy=end.y-start.y,distance=Math.hypot(dx,dy),meteor=document.createElement('div');meteor.className='agent-meteor';meteor.style.left=`${start.x}px`;meteor.style.top=`${start.y}px`;meteor.style.width=`${distance}px`;meteor.style.rotate=`${Math.atan2(dy,dx)}rad`;meteor.style.setProperty('--distance',`${distance}px`);meteor.innerHTML=Array.from({length:18},(_,index)=>`<i style="--delay:${index*13}ms;--lane:${(index%5-2)*3}px"></i>`).join('');document.body.append(meteor);const element=nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);element?.classList.add('agent-materializing');window.setTimeout(()=>{meteor.remove();element?.classList.remove('agent-materializing')},900)}
function positionPromptAgentParticles(){const source=promptAgentTrigger.getBoundingClientRect();promptAgentBurst.style.left=`${source.left+source.width/2}px`;promptAgentBurst.style.top=`${source.top+source.height/2}px`}
function positionPromptAgentCapsule(){const trigger=promptAgentTrigger.getBoundingClientRect(),width=promptAgentPanel.offsetWidth||330,left=Math.max(10,Math.min(innerWidth-width-10,trigger.left+trigger.width/2-width/2));promptAgentPanel.style.right='auto';promptAgentPanel.style.left=`${left}px`;promptAgentPanel.style.bottom=`${Math.max(82,innerHeight-trigger.top+12)}px`}
function playPromptAgentHover(){if(matchMedia('(hover:none)').matches)return;positionPromptAgentParticles();promptAgentBurst.classList.remove('hover-active');void promptAgentBurst.offsetWidth;promptAgentBurst.classList.add('hover-active')}
function collectPromptAgentContext(){const selected=nodes.find(node=>node.id===selectedId),result:FlowNode[]=[],seen=new Set<number>(),visit=(node:FlowNode)=>{if(seen.has(node.id)||result.length>=8)return;seen.add(node.id);result.push(node);links.filter(link=>link.to===node.id).map(link=>nodes.find(item=>item.id===link.from)).filter((item):item is FlowNode=>Boolean(item)).sort((a,b)=>a.y-b.y||a.x-b.x||a.id-b.id).forEach(visit)};for(const id of promptAgentContextSelection){const node=nodes.find(item=>item.id===id);if(node)visit(node)}if(selected)visit(selected);return result}
function selectedPromptAgentNodes(){return [...promptAgentContextSelection].map(id=>nodes.find(node=>node.id===id)).filter((node):node is FlowNode=>Boolean(node))}
function renderPromptAgentContext(reset=false){promptAgentContextNodes=collectPromptAgentContext();if(reset)promptAgentContextSelection=new Set(promptAgentContextNodes.map(node=>node.id));else promptAgentContextSelection=new Set([...promptAgentContextSelection].filter(id=>nodes.some(node=>node.id===id)));const list=promptAgentPanel.querySelector<HTMLElement>('[data-agent-context-list]')!,selectedNodes=selectedPromptAgentNodes(),hint=promptAgentPanel.querySelector<HTMLElement>('.agent-selection-hint')!;promptAgentPanel.classList.toggle('has-materials',selectedNodes.length>0);hint.querySelector('span')!.textContent=selectedNodes.length?`已选择 ${selectedNodes.length} 个素材 · 点击卡片可增减`:'点击卡片选择素材';if(!selectedNodes.length){list.innerHTML='<small>点击卡片添加素材</small>';return}list.innerHTML=selectedNodes.map((node,index)=>`<button type="button" class="active" title="${escapeHtml(node.title)}" data-agent-context-node="${node.id}">${node.mediaUrl&&node.kind==='image'?`<img src="${escapeHtml(node.mediaUrl)}" alt="">`:`<i>${node.kind==='image'?'▧':node.kind==='video'?'▶':'T'}</i>`}<span><b>素材 ${index+1}</b><small>${escapeHtml(node.title)}</small></span><em>✓</em></button>`).join('');list.querySelectorAll<HTMLButtonElement>('[data-agent-context-node]').forEach(button=>button.addEventListener('click',()=>{promptAgentContextSelection.delete(Number(button.dataset.agentContextNode));renderPromptAgentContext(false);draw()}))}
function formPromptAgent(){window.clearTimeout(promptAgentFormTimer);promptAgentContextSelection.clear();promptAgentContextNodes=[];renderPromptAgentContext(false);positionPromptAgentCapsule();const trigger=promptAgentTrigger.getBoundingClientRect(),panel=promptAgentPanel.getBoundingClientRect(),originX=Math.max(0,Math.min(panel.width,trigger.left+trigger.width/2-panel.left)),originY=Math.max(0,Math.min(panel.height,trigger.top+trigger.height/2-panel.top));promptAgentPanel.style.setProperty('--agent-origin-x',`${originX}px`);promptAgentPanel.style.setProperty('--agent-origin-y',`${originY}px`);positionPromptAgentParticles();promptAgentBurst.classList.add('hover-active');promptAgentPanel.classList.add('forming');promptAgentTrigger.classList.add('active');promptAgentFormTimer=window.setTimeout(()=>{promptAgentFormTimer=0;promptAgentPanel.classList.remove('forming');promptAgentPanel.classList.add('open');promptAgentSelecting=true;promptAgentPanel.querySelector('textarea')?.focus();startPromptAgentEffects();draw()},90)}
promptAgentTrigger.addEventListener('pointerenter',playPromptAgentHover)
promptAgentTrigger.addEventListener('pointerleave',()=>promptAgentBurst.classList.remove('hover-active'))
promptAgentTrigger.addEventListener('click',event=>{event.stopPropagation();if(promptAgentPanel.classList.contains('forming')){window.clearTimeout(promptAgentFormTimer);promptAgentFormTimer=0;promptAgentPanel.classList.remove('forming');promptAgentPanel.classList.add('open');promptAgentSelecting=true;promptAgentPanel.querySelector('textarea')?.focus();draw();return}if(!promptAgentPanel.classList.contains('open'))formPromptAgent()})
promptAgentPanel.querySelectorAll<HTMLButtonElement>('[data-agent-kind]').forEach(button=>button.addEventListener('click',()=>{promptAgentKind=button.dataset.agentKind as 'image'|'video';promptAgentPanel.querySelectorAll('[data-agent-kind]').forEach(item=>item.classList.toggle('active',item===button))}))
promptAgentPanel.querySelectorAll<HTMLButtonElement>('[data-agent-complexity]').forEach(button=>button.addEventListener('click',()=>{promptAgentComplexity=button.dataset.agentComplexity as 'simple'|'detailed';promptAgentPanel.querySelectorAll('[data-agent-complexity]').forEach(item=>item.classList.toggle('active',item===button));promptAgentPanel.querySelector<HTMLElement>('.agent-submit b')!.textContent=promptAgentComplexity==='simple'?'生成简洁提示词':'生成详细提示词'}))
function applyPromptAgentPlan(result:PromptAgentResult){
  const sources=selectedPromptAgentNodes(),current=sources[0],kind=result.targetType||result.kind,canUpdate=current&&current.kind===kind&&current.role!=='result'&&!current.mediaUrl,action=result.action==='update_current'&&canUpdate?'update_current':result.action==='create_new'?'create_new':'create_child'
  promptAgentUndo=null;promptAgentAppliedNodeId=0
  const planned=(result.steps||[]).filter(step=>(step.kind==='image'||step.kind==='video')&&step.prompt?.trim()).slice(0,16)
  if(planned.length){
    const imageSources=sources.filter(source=>source.kind==='image'&&Boolean(source.mediaUrl)),createdIds:number[]=[],rightEdge=nodes.length?Math.max(...nodes.map(node=>node.x+node.width)):0,base={x:rightEdge+230,y:current?current.y+80:world({x:innerWidth/2,y:innerHeight/2}).y}
    planned.forEach((step,index)=>{addNode(step.kind,{x:base.x+Math.floor(index/3)*390,y:base.y+(index%3)*270});const created=nodes.find(node=>node.id===selectedId);if(!created)return;created.body=step.prompt.trim();created.generationPrompt=step.prompt.trim();created.title=step.title?.trim()||`Agent · ${step.kind==='video'?'视频':'图像'} ${index+1}`;created.agentAuto=Boolean(result.shouldGenerate);created.status=created.agentAuto?'waiting':'idle';createdIds.push(created.id);const indexes=(step.referenceIndexes||[]).map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=imageSources.length),references=indexes.map(value=>imageSources[value-1]),dependencies=(step.dependsOn||[]).map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=index).map(value=>nodes.find(node=>node.id===createdIds[value-1])).filter((node):node is FlowNode=>Boolean(node));[...references,...dependencies].forEach((source,inputIndex)=>{if(!links.some(link=>link.from===source.id&&link.to===created.id))links.push({from:source.id,to:created.id,fromSide:'right',toSide:'left',inputOrder:inputIndex+1})})})
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
window.addEventListener('contextmenu',event=>{if(!promptAgentPanel.classList.contains('open'))return;event.preventDefault();event.stopImmediatePropagation();dispersePromptAgent()},true)
window.addEventListener('resize',()=>{if(promptAgentPanel.classList.contains('open')){positionPromptAgentCapsule();positionPromptAgentRibbons()}})
document.querySelector('#dock-clear')!.addEventListener('click', () => { if (!nodes.length || !window.confirm('确定清除当前画布中的全部节点和连线吗？')) return; nodes.splice(0); links.splice(0); selectedId = 0; updateEditor(); scheduleSave(); draw() })
const panelBackdrop = document.querySelector<HTMLElement>('#panel-backdrop')!
const workspacePanels = document.querySelectorAll<HTMLElement>('.workspace-panel')
function closeWorkspacePanels() { workspacePanels.forEach(panel => panel.classList.remove('open')); panelBackdrop.classList.remove('open'); document.querySelectorAll('.main-nav button').forEach(button => button.classList.remove('active')) }
function openWorkspacePanel(id: string, trigger: string) { closeWorkspacePanels(); document.querySelector<HTMLElement>(id)!.classList.add('open'); panelBackdrop.classList.add('open'); document.querySelector<HTMLElement>(trigger)!.classList.add('active') }
document.querySelector('#open-projects')!.addEventListener('click', () => { openWorkspacePanel('#projects-panel', '#open-projects'); void loadProjects() })
document.querySelector('#open-assets')!.addEventListener('click', () => { openWorkspacePanel('#assets-panel', '#open-assets'); if (!libraryAssets.length) void loadAssets() })
document.querySelector('#open-square')!.addEventListener('click', () => { openWorkspacePanel('#square-panel', '#open-square'); void loadSquare() })
document.querySelectorAll('.panel-close').forEach(button => button.addEventListener('click', closeWorkspacePanels))
panelBackdrop.addEventListener('click', closeWorkspacePanels)
const assetUpload = document.querySelector<HTMLInputElement>('#asset-upload')!, assetGrid = document.querySelector<HTMLElement>('#asset-grid')!, assetCount = document.querySelector<HTMLElement>('#asset-count')!
const assetPreview = document.querySelector<HTMLElement>('#asset-preview')!, previewImage = document.querySelector<HTMLImageElement>('#preview-image')!, previewVideo = document.querySelector<HTMLVideoElement>('#preview-video')!, previewName = document.querySelector<HTMLElement>('#preview-name')!
let contextUploadPosition: Point | null = null
let draggingAsset: { url: string; name: string; kind: 'image' | 'video' } | null = null
let selectedAsset: { id: string; url: string; name: string; kind: 'image' | 'video'; isPublic: boolean } | null = null
type LibraryAsset = { id: string; projectId: string; projectName: string; name: string; mimeType: string; size: number; createdAt: string; url: string; thumbnailUrl?: string; isPublic: boolean }
let libraryAssets: LibraryAsset[] = [], assetView: 'grid' | 'list' = 'grid'
const selectedAssetIds = new Set<string>(), assetSearch = document.querySelector<HTMLInputElement>('#asset-search')!, assetProjectFilter = document.querySelector<HTMLSelectElement>('#asset-project-filter')!, assetTypeFilter = document.querySelector<HTMLSelectElement>('#asset-type-filter')!, assetSort = document.querySelector<HTMLSelectElement>('#asset-sort')!
const assetContextMenu = document.querySelector<HTMLElement>('#asset-context-menu')!
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
async function uploadImageFiles(files: File[], placement: Point | null, pasted = false) {
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) { showToast('仅支持上传图片', 'warning'); return }
  const button = document.querySelector<HTMLButtonElement>('#upload-assets')!
  button.disabled = true; button.textContent = '正在上传…'
  try {
    const payload = await Promise.all(images.map(async file => ({ name: file.name || `粘贴图片-${Date.now()}.png`, mimeType: file.type, data: await fileBase64(file) })))
    const response = await fetch(`/api/projects/${currentProjectId}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: payload }) })
    if (!response.ok) throw new Error(response.status === 413 ? '图片过大，单张图片不能超过 100MB' : `上传失败（${response.status}）`)
    const uploaded = await response.json() as Array<{ name: string; mimeType: string; url: string }>
    if (placement && uploaded[0]) addMediaNode(uploaded[0].url, uploaded[0].name, placement, 'image')
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
function renderAssets() { const query = assetSearch.value.trim().toLocaleLowerCase(), scope = assetProjectFilter.value, type = assetTypeFilter.value, sort = assetSort.value; const assets = libraryAssets.filter(asset => (scope === 'all' || asset.projectId === currentProjectId) && (type === 'all' || asset.mimeType.startsWith(`${type}/`)) && asset.name.toLocaleLowerCase().includes(query)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'oldest' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)); assetCount.textContent = `${assets.length} 项${selectedAssetIds.size ? ` · 已选 ${selectedAssetIds.size}` : ''}`; assetGrid.className = `asset-grid ${assetView === 'list' ? 'is-list' : ''}`; assetGrid.innerHTML = assets.length ? '' : '<div class="asset-empty"><b>◇</b><span>没有匹配的素材</span><small>尝试调整项目范围、类型或关键词</small></div>'; for (const asset of assets) { const item = document.createElement('article'), kind = asset.mimeType.startsWith('video/') ? 'video' as const : 'image' as const; item.className = `asset-item${asset.isPublic ? ' is-public' : ''}${selectedAssetIds.has(asset.id) ? ' selected' : ''}`; item.innerHTML = `${kind === 'video' ? `<video src="${asset.url}" muted draggable="false" preload="metadata"></video>` : `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="" draggable="false" loading="lazy" decoding="async">`}<button class="asset-select" type="button" aria-label="选择资产">${selectedAssetIds.has(asset.id) ? '✓' : ''}</button><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.projectName || '当前项目')} · ${formatFileSize(asset.size)}</small></footer>`; item.draggable = false; item.title = '单击放到画布 · 右击查看更多'; item.querySelector<HTMLButtonElement>('.asset-select')!.addEventListener('click', event => { event.stopPropagation(); if (selectedAssetIds.has(asset.id)) selectedAssetIds.delete(asset.id); else selectedAssetIds.add(asset.id); renderAssets() }); item.addEventListener('click', () => { addMediaNode(asset.url, asset.name, world({ x: innerWidth / 2, y: innerHeight / 2 }), kind); closeWorkspacePanels() }); item.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); selectedAsset = { id: asset.id, url: asset.url, name: asset.name, kind, isPublic: asset.isPublic }; document.querySelector<HTMLElement>('#asset-context-publish span')!.textContent = asset.isPublic ? '从主页撤下' : '展示到主页'; assetContextMenu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`; assetContextMenu.style.top = `${Math.min(event.clientY, innerHeight - 190)}px`; assetContextMenu.classList.add('open') }); assetGrid.append(item) } const disabled = selectedAssetIds.size === 0; document.querySelector<HTMLButtonElement>('#asset-bulk-delete')!.disabled = disabled; document.querySelector<HTMLButtonElement>('#asset-bulk-download')!.disabled = disabled }
function formatFileSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB` }
type SquareAsset = { id: string; name: string; mimeType: string; createdAt: string; author: string; url: string; thumbnailUrl?: string }
let squareAssets: SquareAsset[] = []
const squareGrid = document.querySelector<HTMLElement>('#square-grid')!, squareSearch = document.querySelector<HTMLInputElement>('#square-search')!
async function loadSquare() { squareGrid.classList.add('loading'); try { const response = await fetch('/api/showcase'); if (!response.ok) throw new Error('load failed'); squareAssets = await response.json() as SquareAsset[]; renderSquare() } catch { squareGrid.innerHTML = '<div class="asset-empty"><b>◇</b><span>作品暂时无法加载</span><small>稍后再试</small></div>' } finally { squareGrid.classList.remove('loading') } }
function renderSquare() { const query = squareSearch.value.trim().toLocaleLowerCase(), assets = squareAssets.filter(asset => `${asset.name} ${asset.author}`.toLocaleLowerCase().includes(query)); document.querySelector<HTMLElement>('#square-count')!.textContent = `${assets.length} 项`; squareGrid.innerHTML = assets.length ? '' : '<div class="asset-empty"><b>◇</b><span>没有找到作品</span><small>换个关键词试试</small></div>'; for (const asset of assets) { const video = asset.mimeType.startsWith('video/'), card = document.createElement('article'); card.className = 'square-card'; card.tabIndex = 0; card.innerHTML = `${video ? `<video src="${asset.url}" muted playsinline preload="metadata"></video>` : `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async">`}<i>${video ? '▶' : '⌕'}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || 'Viora 创作者')}</small></footer>`; const open = () => openAssetPreview(asset.url, asset.name, video ? 'video' : 'image'); card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter') open() }); squareGrid.append(card) } }
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
async function loadGenerationCapabilities() { try { const response = await fetch('/api/generation/capabilities'); if (response.ok) generationCapabilities = await response.json() as GenerationCapabilities } catch { /* 使用通用默认配置 */ } }
async function bootstrapApplication() {
  try { const response = await fetch('/api/users/me'); if (response.ok) authUser = await response.json() as AuthUser } catch { authUser = null }
  authReady = true; localStorage.removeItem('flow-authenticated'); renderAuthenticatedUser(); await loadGenerationCapabilities()
  if (authUser && await ensureCurrentUserProject() && location.hash === '#/canvas') await Promise.all([loadCanvas(), loadAssets()])
  applyAppRoute()
}
window.addEventListener('resize', resize); resize(); updateEditor(); void bootstrapApplication()
