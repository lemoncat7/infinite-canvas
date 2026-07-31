const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless:true }); const page = await browser.newPage(); let submitted
  await page.route('**/api/projects/*/canvas', route => route.request().method() === 'PUT' ? route.fulfill({ status:200, contentType:'application/json', body:'{}' }) : route.continue())
  await page.route('**/api/jobs', async route => { if (route.request().method() === 'POST') { submitted = route.request().postDataJSON(); await route.fulfill({ status:202, contentType:'application/json', body:JSON.stringify({ id:'test-job', status:'queued', progress:0 }) }) } else route.continue() })
  await page.route('**/api/jobs/test-job', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ status:'failed', progress:0, error:'test complete' }) }))
  await page.goto('http://127.0.0.1:4173/', { waitUntil:'networkidle' }); await page.click('.canvas-dock [data-add="image"]')
  const node = page.locator('.flow-node.kind-image.selected'); const panel = node.locator('.image-config-panel'); const emptyText = await node.locator('.image-empty-state').innerText(); await panel.locator('[data-image-field="description"]').fill('海边的红色房子'); await panel.locator('summary').click(); await panel.locator('[data-image-field="size"]').selectOption('1536x1024'); await panel.locator('[data-image-field="quality"]').selectOption('high'); await panel.locator('[data-image-field="background"]').selectOption('transparent'); await panel.locator('[data-image-generate]').click(); await page.waitForTimeout(100)
  console.log(JSON.stringify({ open:await panel.evaluate(el => el.classList.contains('open')), emptyText, settingsVisible:await panel.locator('.image-settings-popover').isVisible(), model:await panel.locator('[data-image-field="model"]').inputValue(), submitted }))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
