const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(); let imageRequests = 0
  page.on('request', request => { if (/\/api\/assets\/[^/]+\/content/.test(request.url())) imageRequests++ })
  await page.addInitScript(projectId => localStorage.setItem('flow-project-id', projectId), '013994da-c554-44a4-b8e4-df3e63728ebe')
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.querySelector('#dock-appearance').disabled)
  const loadedRequests = imageRequests
  await page.click('#dock-appearance'); await page.waitForTimeout(800)
  console.log(JSON.stringify({ loadedRequests, requestsAfterTheme: imageRequests - loadedRequests, buttonEnabledAfterLoad: loadedRequests > 0 }))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
