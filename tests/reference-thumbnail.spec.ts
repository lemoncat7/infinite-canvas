import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const width of [375, 1280]) {
    for (const count of [1, 3]) {
      test(`reference thumbnails do not tile: ${theme}, ${width}px, ${count} references`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.setContent(`<body data-theme="${theme}">
          <div class="image-empty-state" style="width:300px">
            <span class="placeholder-icon">+</span>
            <div class="video-storyboard" style="--frame-count:${count}">
              ${Array.from({ length: count }, (_, i) => `<i class="has-image"><span class="reference-image"></span><b>${i + 1}</b></i>`).join('')}
            </div>
          </div></body>`);
        await page.addStyleTag({ path: 'src/style.css' });
        await page.locator('.reference-image').evaluateAll(elements => {
          const canvas = document.createElement('canvas');
          canvas.width = 32; canvas.height = 32;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#477fb8'; context.fillRect(0, 0, 32, 32);
          context.fillStyle = '#fff'; context.fillRect(8, 8, 16, 16);
          elements.forEach(element => {
            (element as HTMLElement).style.backgroundImage = `url("${canvas.toDataURL()}")`;
          });
        });
        const references = page.locator('.reference-image');
        await expect(references).toHaveCount(count);
        for (const reference of await references.all()) {
          await expect(reference).toHaveCSS('background-repeat', 'no-repeat');
          await expect(reference).toHaveCSS('background-size', 'cover');
          await expect(reference).toHaveCSS('background-position', '50% 50%');
          await expect(reference).toHaveCSS('box-shadow', 'none');
          expect(await reference.evaluate(e => getComputedStyle(e).backgroundImage)).toContain('data:image/png');
        }
        if (theme === 'light') {
          expect(await page.locator('.placeholder-icon').evaluate(e => getComputedStyle(e).backgroundImage)).toContain('linear-gradient');
        }
      });
    }
  }
}
