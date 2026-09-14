import { test, expect, type Page } from '@playwright/test'

async function fixture(page: Page, admin = true, withNode = false) {
  let revision = 1
  const providers = [{ id: 'p', name: '测试服务商', baseUrl: 'https://example.com', proxyUrl: '', enabled: true, hasKey: true, readOnly: false }]
  const models = [{ id: 'global:m', name: '全局图片模型', model: 'image-test', providerId: 'p', adapter: 'openai-image', kind: 'image', enabled: true, order: 0, creditCost: 0, capabilities: { referenceImages: 1, transparent: true, sizes: ['512x512', '1024x1024'], resolutions: [], aspectRatios: [], minSeconds: 1, maxSeconds: 18 } }]
  const defaults: Record<string, string> = { image: 'global:m' }
  const state = () => ({ revision, imported: true, providers, models, defaults })
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    let body: unknown = {}; let status = 200
    if (path === '/api/users/me') body = { id: 'u', name: '测试管理员', username: 'test', email: 'test@example.invalid', credits: 10, isAdmin: admin }
    else if (path === '/api/projects') body = [{ id: 'p1', name: '测试画布' }]
    else if (path === '/api/projects/p1/canvas') body = { nodes: withNode ? [{ id: 1, publicId: 'image-test-1', accent: '#8ee7ff', kind: 'image', x: -100, y: -90, width: 240, height: 180, title: '测试图片', body: '生成图片', model: 'global:m', imageSettings: { size: '512x512' }, status: 'idle', progress: 0 }] : [], links: [], camera: { x: 0, y: 0, zoom: 1 }, version: 1 }
    else if (path.includes('id-block')) body = { projectId: 'p1', start: 2, end: 10000 }
    else if (path === '/api/models/catalog') body = { revision, models, defaults }
    else if (path === '/api/admin/models' && req.method() === 'GET') body = state()
    else if (path === '/api/admin/model-providers' && req.method() === 'POST') {
      const data = req.postDataJSON()
      providers.push({ ...data, apiKey: undefined, hasKey: !!data.apiKey, readOnly: false, id: 'p2' }); revision++; body = state()
    } else if (path === '/api/admin/models' && req.method() === 'POST') {
      const data = req.postDataJSON(); models.push({ ...data, kind: 'image', id: 'global:added' }); revision++; body = state()
    } else if (path.endsWith('/discover')) body = { models: ['new-image-id', 'second-image-id'] }
    else if (path === '/api/admin/model-defaults') { Object.assign(defaults, req.postDataJSON().defaults); revision++; body = state() }
    else if (path.includes('notifications') || path.includes('assets') || path === '/api/user-api-models') body = []
    else if (path === '/api/generation/capabilities') body = { image: { defaultModel: 'global:m' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/#/canvas')
  await expect(page.locator('body')).not.toHaveClass(/app-loading/)
}

for (const width of [375, 1024, 1440]) for (const theme of ['light', 'dark']) test(`global model workspace ${width} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(theme => localStorage.setItem('flow-theme-preference', theme), theme)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  await page.locator('#workspace-user').click()
  await page.locator('#open-global-models').click()
  const workspace = page.getByRole('dialog', { name: '全局模型管理', exact: true })
  await expect(workspace.getByText('全局图片模型', { exact: true })).toBeVisible()
  expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await workspace.getByRole('button', { name: '服务商连接', exact: true }).click()
  await workspace.getByRole('button', { name: '新增连接', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑模型配置', exact: true })
  await editor.getByLabel('连接名称', { exact: true }).fill('我的服务商')
  await editor.getByLabel('接口地址', { exact: true }).fill('https://api.example.com/v1')
  await editor.getByLabel('API 密钥', { exact: false }).fill('test-secret')
  await editor.getByRole('button', { name: '显示密钥' }).click()
  await expect(editor.locator('[name=apiKey]')).toHaveAttribute('type', 'text')
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await editor.getByRole('button', { name: '保存配置' }).click()
  await expect(editor).not.toBeVisible()
  await expect(workspace.getByText('我的服务商', { exact: true })).toBeVisible()
  await workspace.getByRole('button', { name: '模型目录', exact: true }).click()
  await workspace.getByRole('button', { name: '新增模型', exact: true }).click()
  await editor.getByLabel('显示名称', { exact: true }).fill('新的图片模型')
  await editor.getByLabel('上游模型 ID', { exact: true }).fill('new-image-id')
  await editor.getByRole('button', { name: '保存配置' }).click()
  await expect(workspace.getByText('新的图片模型', { exact: true })).toBeVisible()
  await workspace.getByRole('button', { name: '默认分配', exact: true }).click()
  await workspace.getByRole('combobox', { name: '图片生成', exact: true }).selectOption('global:added')
  await workspace.getByRole('button', { name: '保存默认分配' }).click()
  await expect(workspace.locator('output').first()).toContainText('已保存')
  await workspace.getByRole('button', { name: '模型目录', exact: true }).click()
  await page.screenshot({ path: `/tmp/canvas-models-${width}-${theme}.png` })
  expect(errors).toEqual([])
})

test('ordinary users do not see admin entry', async ({ page }) => {
  await fixture(page, false)
  await page.locator('#workspace-user').click()
  await expect(page.locator('#open-global-models')).toBeHidden()
})

test('image composer uses catalog model and preserves configured custom size on reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page, false, true)
  await expect(page.locator('#canvas-pixi')).toBeVisible()
  await page.locator('.flow-node .image-empty-state b').click()
  const panel = page.locator('.flow-node.selected > .image-config-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-image-model-label]')).toHaveText('全局图片模型')
  await panel.locator('[data-image-settings-label]').click()
  const size = panel.getByRole('combobox', { name: '图片尺寸' })
  await expect(size).toBeVisible()
  await expect(size).toHaveValue('512x512')
  await size.selectOption('1024x1024')
  await expect(panel.locator('[data-image-settings-label]')).toContainText('1:1')
})
