const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0' })
  const errors = []; let crashed = false
  page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => { crashed = true })
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  for (let round = 0; round < 10; round++) {
    await page.evaluate(() => { const button = document.querySelector('#dock-appearance'); for (let index = 0; index < 12; index++) button.click() })
    await page.waitForTimeout(1450)
  }
  console.log(JSON.stringify({ crashed, errors, theme: await page.locator('body').getAttribute('data-theme'), url: page.url(), nativeTransitions: await page.evaluate(() => document.getAnimations({ subtree:true }).some(animation => String(animation.effect?.pseudoElement || '').includes('view-transition'))) }))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
