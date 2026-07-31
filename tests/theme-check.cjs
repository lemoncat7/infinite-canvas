const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  const before = await page.locator('body').getAttribute('data-theme')
  await page.evaluate(() => { const button = document.querySelector('#dock-appearance'); for (let index = 0; index < 8; index++) button.click() })
  await page.waitForTimeout(80)
  const during = await page.evaluate(() => ({
    theme: document.body.dataset.theme,
    storedTheme: localStorage.getItem('flow-theme'),
    x: getComputedStyle(document.documentElement).getPropertyValue('--theme-x'),
    radius: getComputedStyle(document.documentElement).getPropertyValue('--theme-radius'),
    animations: document.getAnimations({ subtree: true }).map(animation => animation.animationName),
    wavePolygon: document.getAnimations({ subtree: true }).some(animation => animation.effect?.getKeyframes?.().some(frame => String(frame.clipPath || '').startsWith('polygon('))),
    nativeViewTransition: document.getAnimations({ subtree: true }).some(animation => String(animation.effect?.pseudoElement || '').includes('view-transition')),
    panelExists: Boolean(document.querySelector('#appearance-panel')),
    locked: document.querySelector('#dock-appearance').disabled,
  }))
  await page.waitForTimeout(800)
  const stillLockedDuringCooldown = await page.locator('#dock-appearance').isDisabled()
  await page.waitForTimeout(750)
  const unlocked = await page.locator('#dock-appearance').isEnabled()
  await page.reload({ waitUntil: 'networkidle' })
  const persisted = await page.locator('body').getAttribute('data-theme')
  console.log(JSON.stringify({ before, during, stillLockedDuringCooldown, unlocked, persisted }))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
