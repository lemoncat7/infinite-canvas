import { expect, test, type Page } from "@playwright/test";

const projectId = "canvas-stress-project";

function stressCanvas(count = 400) {
  const nodes = Array.from({ length: count }, (_, index) => {
    const column = index % 20;
    const row = Math.floor(index / 20);
    return {
      id: index + 1,
      publicId: `stress-${index + 1}`,
      kind: index % 3 === 0 ? "image" : "note",
      x: -300 + column * 320,
      y: -100 + row * 250,
      width: 240,
      height: 180,
      title: `压力节点 ${index + 1}`,
      body: `用于验证视口虚拟化与空间索引的节点 ${index + 1}`,
      accent: "#7da9df",
      status: "idle",
      progress: 0,
    };
  });
  return {
    nodes,
    links: nodes.slice(1).map((node, index) => ({
      from: nodes[index].id,
      to: node.id,
      fromSide: "right",
      toSide: "left",
    })),
    camera: { x: 0, y: 0, zoom: 1 },
    version: 1,
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

async function mockApi(page: Page, count = 400, preserveLocalCanvas = false) {
  const canvas = stressCanvas(count);
  const syncPayloads: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === "/api/users/me")
      body = {
        id: "stress-user",
        name: "压力测试",
        username: "stress",
        email: "stress@example.invalid",
        inviteCode: "TEST",
        credits: 100,
        reservedCredits: 0,
      };
    else if (path === "/api/projects") body = [{ id: projectId }];
    else if (path === `/api/projects/${projectId}/canvas`) body = canvas;
    else if (path === `/api/projects/${projectId}/canvas/id-block`)
      body = { projectId, start: count + 1, end: count + 10_000 };
    else if (path === "/api/assets" || path === "/api/user-api-models")
      body = [];
    else if (path === "/api/generation/capabilities") body = {};
    else if (path === "/api/jobs" && request.method() === "POST")
      body = { id: "canvas-test-job", status: "queued", progress: 0 };
    else if (path === "/api/jobs/canvas-test-job")
      body = { id: "canvas-test-job", status: "running", progress: 35 };
    else if (path.includes("/canvas/sync")) {
      syncPayloads.push(request.postDataJSON());
      if (preserveLocalCanvas) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "test_sync_deferred" }),
        });
        return;
      }
      body = { ...canvas, version: 2, updatedAt: new Date().toISOString() };
    }
    else if (path.includes("notifications")) body = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { canvas, syncPayloads };
}

test("homepage defers Pixi until the workspace is opened", async ({ page }) => {
  await mockApi(page, 20);
  const pixiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("pixi-renderer")) pixiRequests.push(request.url());
  });
  await page.goto("/?canvasPerf=1");
  await expect(page.locator(".home-page")).toBeVisible();
  expect(pixiRequests).toHaveLength(0);
});

test("400 nodes stay GPU-virtualized and recover WebGL context", async ({
  page,
}) => {
  const { canvas } = await mockApi(page);
  (canvas.nodes[0] as (typeof canvas.nodes)[number] & { mediaUrl?: string })
    .mediaUrl = "/api/assets/delayed-test/content";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).toHaveClass(/renderer-pixi/);
  const mediaPlaceholderColors = await page
    .locator('.flow-node[data-id="1"] .node-media-canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!,
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data,
        colors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4 * 97)
        colors.add(
          `${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`,
        );
      return colors.size;
    });
  expect(mediaPlaceholderColors).toBeGreaterThan(1);
  const visibleDomCards = await page.locator("#node-layer > .flow-node").count();
  expect(visibleDomCards).toBeGreaterThan(0);
  expect(visibleDomCards).toBeLessThanOrEqual(120);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({
      path: "test-results/canvas-unselected.png",
      fullPage: true,
    });

  await page.locator('.flow-node[data-id="1"]').click();
  await expect(page.locator("#node-layer > .flow-node.selected")).toHaveCount(1);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({
      path: "test-results/canvas-selected.png",
      fullPage: true,
    });
  expect(await page.locator("#node-layer > .flow-node").count()).toBeLessThanOrEqual(120);

  const primaryImage = page.locator('.flow-node[data-id="1"]');
  const domIdsBeforeGeneration = await page
    .locator("#node-layer > .flow-node")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")));
  await primaryImage
    .locator('[data-image-field="description"]')
    .fill("大规模画布生成回归测试");
  await primaryImage.locator("[data-image-generate]").dispatchEvent("click");
  await page.waitForTimeout(120);
  const domIdsAfterGeneration = await page
    .locator("#node-layer > .flow-node")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")));
  expect(domIdsAfterGeneration.sort()).toEqual(domIdsBeforeGeneration.sort());
  const blankDomCards = await page
    .locator("#node-layer > .flow-node")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .filter((element) => !(element.textContent || "").trim()).length,
    );
  expect(blankDomCards).toBe(0);
  await primaryImage.click({ position: { x: 24, y: 24 } });
  await expect(primaryImage).toHaveClass(/selected/);

  await page.evaluate(() =>
    (
      window as typeof window & {
        __canvasPerformance?: { reset(): void };
      }
    ).__canvasPerformance?.reset(),
  );

  await page.mouse.move(900, 700);
  await page.mouse.down();
  await page.mouse.move(700, 570, { steps: 24 });
  await page.mouse.up();
  // Panning intentionally preserves selection so upstream/downstream links
  // remain highlighted while the user searches the graph.
  await expect(page.locator("#node-layer > .flow-node.selected")).toHaveCount(1);

  const perf = await page.evaluate(() =>
    (
      window as typeof window & {
        __canvasPerformance?: { snapshot(): { averagePaintMs: number } };
      }
    ).__canvasPerformance?.snapshot(),
  );
  expect(perf).toBeTruthy();
  // Headless Chromium uses software WebGL in CI. This threshold is a
  // regression guard; real GPU-backed browser measurements are lower.
  expect(perf!.averagePaintMs).toBeLessThan(30);

  const contextRecovery = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas-pixi")!;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 80);
    return true;
  });
  expect(contextRecovery).toBe(true);
  await expect(page.locator("body")).not.toHaveClass(/canvas-context-lost/, {
    timeout: 5_000,
  });

  expect(errors).toEqual([]);
});

test("mobile uses bounded DPR and touch selection", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await mockApi(page, 300);
  await page.goto("/?canvasPerf=1#/canvas");
  const pixi = page.locator("#canvas-pixi");
  await expect(pixi).toBeVisible({ timeout: 15_000 });
  const dimensions = await pixi.evaluate((canvas: HTMLCanvasElement) => ({
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    width: canvas.width,
    height: canvas.height,
  }));
  expect(dimensions.width / dimensions.cssWidth).toBeLessThanOrEqual(1.5);
  expect(dimensions.height / dimensions.cssHeight).toBeLessThanOrEqual(1.5);
  await page.touchscreen.tap(65, 322);
  await expect(page.locator("#node-layer > .flow-node.selected")).toHaveCount(1);
  await context.close();
});

test("connection overlay and quick group movement stay in the Pixi path", async ({
  page,
}) => {
  const { syncPayloads } = await mockApi(page, 40);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });

  // Node 1 is at screen (340,260), node 3 starts at (980,260).
  await page.locator('.flow-node[data-id="1"]').click();
  const output = page.locator(".flow-node.selected .node-port.output");
  await expect(output).toBeVisible();
  const outputBox = await output.boundingBox();
  expect(outputBox).toBeTruthy();
  await page.mouse.move(outputBox!.x + outputBox!.width / 2, outputBox!.y + outputBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(980, 350, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(
    syncPayloads.some((payload) =>
      JSON.stringify(payload).includes('"from":1') &&
      JSON.stringify(payload).includes('"to":3'),
    ),
  ).toBe(true);

  // Ctrl-drag is the temporary marquee shortcut and must leave a usable
  // multi-selection that moves as one group.
  await page.keyboard.down("Control");
  await page.mouse.move(325, 245);
  await page.mouse.down();
  await page.mouse.move(915, 455, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(page.locator("[data-batch-count]")).toContainText("2");
  await page.mouse.move(370, 350);
  await page.mouse.down();
  await page.mouse.move(470, 430, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("[data-batch-count]")).toContainText("2");
  expect(errors).toEqual([]);
});

test("card creation, generation and repeated dragging never reveal foreign panels", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await mockApi(page, 6, true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });

  for (const [kind, point] of [
    ["prompt", { x: 80, y: 500 }],
    ["image", { x: 360, y: 500 }],
    ["video", { x: 640, y: 500 }],
    ["voice", { x: 920, y: 500 }],
    ["tts", { x: 1200, y: 500 }],
  ] as const) {
    await page.mouse.dblclick(point.x, point.y);
    const menu = page.locator("#quick-node-menu.open");
    await expect(menu).toBeVisible();
    await menu.locator(`[data-quick-add="${kind}"]`).click();
  }

  await expect(page.locator(".flow-node.kind-prompt")).toHaveCount(1);
  await expect(page.locator(".flow-node.kind-video")).toHaveCount(1);
  await expect(page.locator(".flow-node.kind-voice")).toHaveCount(1);
  await expect(page.locator(".flow-node.kind-tts")).toHaveCount(1);
  await expect(
    page.locator(".flow-node:not(.kind-audio) > .audio-result-panel:visible"),
  ).toHaveCount(0);

  const generatedImage = page.locator(".flow-node.kind-image").last();
  await generatedImage.click();
  await generatedImage
    .locator('[data-image-field="description"]')
    .fill("动漫风夜景城市，固定镜头，无人物、文字或水印。");
  const audioCountBefore = await page.locator(".flow-node.kind-audio").count();
  await generatedImage.locator("[data-image-generate]").dispatchEvent("click");
  await expect(generatedImage).toHaveClass(/generating/);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({ path: "test-results/generation-before-pan.png" });

  // Repeated panning while the task status changes used to expose the Pixi
  // fallback and DOM card at once, making status and audio panels flash.
  for (let index = 0; index < 6; index++) {
    await page.mouse.move(820, 560);
    await page.mouse.down();
    await page.mouse.move(780 + index * 3, 530 + index * 2, { steps: 8 });
    await page.mouse.up();
  }
  await expect(page.locator(".flow-node.kind-audio")).toHaveCount(
    audioCountBefore,
  );
  await expect(
    page.locator(".flow-node:not(.kind-audio) > .audio-result-panel:visible"),
  ).toHaveCount(0);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({ path: "test-results/generation-after-pan.png" });

  // Drag the generating card repeatedly as well; it must remain one complete
  // DOM card and must not swap to another card type while moving.
  const box = await generatedImage.boundingBox();
  expect(box).toBeTruthy();
  for (let index = 0; index < 4; index++) {
    await page.mouse.move(box!.x + 40 + index * 6, box!.y + 45 + index * 4);
    await page.mouse.down();
    await page.mouse.move(box!.x + 80 + index * 6, box!.y + 70 + index * 4, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect(generatedImage).toHaveCount(1);
  await expect(generatedImage.locator(".audio-result-panel:visible")).toHaveCount(0);
  expect(errors).toEqual([]);
});
