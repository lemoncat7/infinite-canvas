import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: 'import { PixiCanvasRenderer } from "./src/canvas/pixi-renderer"; window.TestRenderer = PixiCanvasRenderer;', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  bundle = result.outputFiles[0].text;
});

test('running links reuse geometry and stop on completion or blur', async ({ page }) => {
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => {
    const w = window as any, renderer = new w.TestRenderer();
    await renderer.mount(document.body);
    w.renderer = renderer; w.paints = 0; w.geometry = 0;
    const paint = renderer.app.renderer.render.bind(renderer.app.renderer);
    renderer.app.renderer.render = (...args: any[]) => { w.paints++; return paint(...args); };
    const geometry = renderer.renderLinkGeometry.bind(renderer);
    renderer.renderLinkGeometry = (...args: any[]) => { w.geometry++; return geometry(...args); };
    w.snapshot = { nodes: [{ id: 1, x: 0, y: 0, width: 100, height: 100, status: 'running' }, { id: 2, x: 200, y: 0, width: 100, height: 100 }], links: [{ from: 1, to: 2, fromSide: 'right', toSide: 'left' }], camera: { x: 0, y: 0, zoom: 1 }, selectedId: -1, selectedIds: [], dark: false, backgroundMode: 'dots', hoveredLinkIndex: -1, touchSelectedLinkIndex: -1 };
    window.dispatchEvent(new Event('focus'));
    renderer.render(w.snapshot);
  });
  await page.waitForTimeout(150);
  const initial = await page.evaluate(() => ({ paints: (window as any).paints, geometry: (window as any).geometry }));
  expect(initial.paints).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const flowing = await page.evaluate(() => ({ paints: (window as any).paints, geometry: (window as any).geometry }));
  expect(flowing.paints).toBeGreaterThan(initial.paints);
  expect(flowing.geometry).toBe(initial.geometry);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const stopped = await page.evaluate(() => (window as any).paints);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).paints)).toBe(stopped);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const result = await page.evaluate(() => {
    const w = window as any, r = w.renderer;
    r.render(w.snapshot); const unchanged = w.geometry;
    window.dispatchEvent(new Event('blur')); const before = w.paints;
    r.render({ ...w.snapshot, nodes: w.snapshot.nodes.map((n: any) => ({ ...n, x: n.x + 50 })) });
    const blurred = w.paints;
    window.dispatchEvent(new Event('focus')); const focused = w.paints;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange')); r.render(w.snapshot); const hidden = w.paints;
    r.suspend(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange')); const stillSuspended = w.paints;
    r.resume(); const resumed = w.paints;
    const resolution = r.app.renderer.resolution;
    return { unchanged, before, blurred, focused, hidden, stillSuspended, resumed, resolution };
  });
  expect(result.unchanged).toBe(initial.geometry);
  expect(result.blurred).toBe(result.before);
  expect(result.focused).toBe(result.before + 1);
  expect(result.hidden).toBe(result.focused);
  expect(result.stillSuspended).toBe(result.hidden);
  expect(result.resumed).toBe(result.hidden + 1);
  expect(result.resolution).toBeLessThanOrEqual(1.5);
  await page.evaluate(() => {
    const w = window as any;
    w.renderer.render({ ...w.snapshot, nodes: w.snapshot.nodes.map((n: any) => ({ ...n, status: 'succeeded' })) });
  });
  const completed = await page.evaluate(() => (window as any).paints);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).paints)).toBe(completed);
  await page.evaluate(() => (window as any).renderer.destroy());
});
