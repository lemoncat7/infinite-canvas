const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  let popupCount = 0
  context.on('page', opened => { if (opened !== page) popupCount++ })
  const navigations = []
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()) })
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
  await page.waitForSelector('.flow-node')

  let imageNode = page.locator('.flow-node:has(.node-media[data-has-media="true"])').first()
  if (!await imageNode.count()) {
    await page.click('#open-assets')
    await page.waitForSelector('.asset-item')
    await page.locator('.asset-item').first().click()
    imageNode = page.locator('.flow-node:has(.node-media[data-has-media="true"])').last()
    await imageNode.waitFor()
  }

  async function dragAndMeasure(locator, dx, dy) {
    const before = await locator.boundingBox()
    if (!before) throw new Error('Node has no bounding box')
    const x = before.x + before.width / 2, y = before.y + before.height / 2
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.flow-node')?.getAttribute('data-id') || document.elementFromPoint(x, y)?.className, { x, y })
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 24 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    const after = await locator.boundingBox()
    return { dx: Number((after.x - before.x).toFixed(2)), dy: Number((after.y - before.y).toFixed(2)), id: await locator.getAttribute('data-id'), hit }
  }

  const textNode = page.locator('.flow-node.kind-prompt,.flow-node.kind-note').first()
  const textMove = await dragAndMeasure(textNode, 120, 70)
  const imageMove = await dragAndMeasure(imageNode, 120, 70)
  const imageElements = await imageNode.locator('img').count()
  const mediaCanvases = await imageNode.locator('.node-media-canvas').count()
  const backgroundImage = await imageNode.locator('.node-media').evaluate(element => getComputedStyle(element).backgroundImage)
  const result = { textMove, imageMove, imageElements, mediaCanvases, backgroundImage, popupCount, pageCount: context.pages().length, url: page.url(), navigations }
  console.log(JSON.stringify(result))
  const stable = Math.abs(textMove.dx - 120) < 2 && Math.abs(textMove.dy - 70) < 2 && Math.abs(imageMove.dx - 120) < 2 && Math.abs(imageMove.dy - 70) < 2
  await dragAndMeasure(textNode, -120, -70)
  await dragAndMeasure(imageNode, -120, -70)
  if (!stable || imageElements !== 0 || mediaCanvases !== 1 || backgroundImage !== 'none' || popupCount !== 0 || context.pages().length !== 1 || page.url() !== 'http://127.0.0.1:4173/') process.exitCode = 1
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
