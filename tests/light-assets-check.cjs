const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => localStorage.setItem('flow-theme', 'light'))
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  await page.click('#open-assets')
  const colors = await page.evaluate(() => {
    const read = selector => { const style = getComputedStyle(document.querySelector(selector)); return { color: style.color, background: style.backgroundColor, border: style.borderColor } }
    return { panel: read('#assets-panel'), heading: read('#assets-panel h2'), upload: read('#upload-assets'), emptyIcon: document.querySelector('.asset-empty') ? read('.asset-empty b') : null, section: read('#assets-panel .panel-section-title') }
  })
  console.log(JSON.stringify(colors))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
