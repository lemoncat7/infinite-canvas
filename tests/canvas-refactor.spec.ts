import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mergeGenerationState } from "../src/services/generation-poller";
import { labelTextViewport } from "../src/nodes/label-text-layout";
import { NODE_SNAP_GAP, snapNodeGroup } from "../src/canvas/node-snap-controller";
import { positionDraggedNodes } from "../src/canvas/node-drag-positioner";
import { VIDEO_CARD_LAYOUT, videoFrameLayout } from "../src/nodes/video-card-layout";
import { NODE_CARD_STYLE } from "../src/nodes/node-card-style";
import { composeImageGenerationPrompt, TRANSPARENT_BACKGROUND_CONSTRAINT } from "../src/nodes/image-node";

test("shared toolbar styling only lays out actions allowed by the node type contract", () => {
  const chrome = readFileSync("src/styles/workspace-chrome.css", "utf8");
  expect(chrome).toContain(".node-floating-tools button:not([hidden])");
  expect(chrome).not.toContain(".node-floating-tools button[hidden]");
});

test("video card reference frames stay horizontally centered", () => {
  const width = 240;
  const layout = videoFrameLayout(width, 3);
  const lastRight =
    layout.frameX(layout.frameCount - 1) + layout.frameWidth;
  expect(layout.frameX(0)).toBe(VIDEO_CARD_LAYOUT.horizontalPadding);
  expect(lastRight).toBeCloseTo(width - VIDEO_CARD_LAYOUT.horizontalPadding);
  expect(layout.contentRight).toBe(width - VIDEO_CARD_LAYOUT.horizontalPadding);
});

test("video card keeps one empty slot then follows the exact reference count", () => {
  expect(videoFrameLayout(240, 0).frameCount).toBe(1);
  expect(videoFrameLayout(240, 0).frameWidth).toBeGreaterThan(0);
  expect(videoFrameLayout(240, 1).frameCount).toBe(1);
  expect(videoFrameLayout(240, 2).frameCount).toBe(2);
  expect(videoFrameLayout(240, 4).frameCount).toBe(4);
  expect(videoFrameLayout(240, 8).frameCount).toBe(8);
});

test("selected DOM video card repaints linked reference thumbnails", () => {
  const source = readFileSync("src/canvas/node-media-renderer.ts", "utf8");
  const repaint = source.slice(
    source.indexOf("repaintUrl(url"),
    source.indexOf("repaintAll()"),
  );
  expect(repaint).toContain("[data-reference-url=");
  expect(repaint).toContain("this.drawImage(target, image)");
});

test("selected video generator supports pointer drag reference swapping", () => {
  const source = readFileSync("src/nodes/video-reference-view.ts", "utf8");
  expect(source).toContain("frame.setPointerCapture(event.pointerId)");
  expect(source).toContain("getBoundingClientRect()");
  expect(source).toContain("referenceAtPoint(event.clientX, event.clientY)");
  expect(source).toContain("exchangeReferences(");
  expect(source).toContain("exchangeImageReferenceOrder(");
  expect(source).toContain("frame.classList.add(\"is-dragging\")");
  expect(source).toContain("?.classList.add(\"drag-over\")");
});

test("Pixi renders only the canvas surface and links", () => {
  const pixi = readFileSync("src/canvas/pixi-renderer.ts", "utf8");
  expect(pixi).toContain("this.world.addChild(this.links, this.activeLinks)");
  expect(pixi).not.toContain("cardViews");
  expect(pixi).not.toMatch(/\bSprite\b/);
  expect(pixi).not.toContain("PixiTextureCache");
  expect(pixi).not.toContain("createPixiCardText");
});

test("completed Pixi video result opens preview on double click", () => {
  const pointer = readFileSync("src/canvas/canvas-pointer-lifecycle.ts", "utf8");
  const domPointer = readFileSync("src/nodes/node-interaction-view.ts", "utf8");
  expect(pointer).toContain('node.kind === "video" && node.role === "result"');
  expect(pointer).toContain("this.o.previewMedia(node)");
  expect(domPointer).toContain('current.kind === "video" && current.role === "result"');
  expect(domPointer).not.toContain('.querySelector<HTMLElement>(".node-media")!');
});

test("image and video generators share one card geometry", () => {
  expect(NODE_CARD_STYLE.generatorWidth).toBe(290);
  expect(NODE_CARD_STYLE.generatorHeight).toBe(225);
  const state = readFileSync("src/nodes/node-dom-state.ts", "utf8");
  expect(state).toContain("NODE_CARD_STYLE.generatorWidth");
});

test("DOM-owned card follows pointer in the drag animation frame", () => {
  const source = readFileSync("src/canvas/dom-pointer-lifecycle.ts", "utf8");
  expect(source).toContain("drag.element.style.transform = `translate(${item.x}px, ${item.y}px)`");
});

test("interaction suspension follows renderer ownership", () => {
  const style = readFileSync("src/style.css", "utf8") + readFileSync("src/styles/theme.css", "utf8");
  expect(style).toContain('#node-layer.dom-interaction-suspended > .flow-node .node-config-panel');
  expect(style).not.toContain('#node-layer.dom-interaction-suspended > .flow-node { display:none');
});

test("DOM card viewport advances in the interaction hot path", () => {
  const paint = readFileSync("src/canvas/canvas-paint-coordinator.ts", "utf8");
  const hotPath = paint.slice(
    paint.indexOf("if (this.options.interacting())"),
    paint.indexOf("this.businessRenderPending = false"),
  );
  expect(hotPath).toContain("this.positionCardLayer()");
  expect(hotPath).toContain("updateInteraction(snapshot)");
});

test("selecting a DOM card restores its native controls", () => {
  const input = readFileSync("src/canvas/canvas-input-feature.ts", "utf8");
  expect(input).toContain("options.showSelectedDom();");
});

test("dragging one selected video reference onto another swaps its order", async ({ page }) => {
  const { canvas } = await mockApi(page, 3, true);
  canvas.nodes.splice(0, canvas.nodes.length,
    { id: 1, kind: "image", x: -450, y: -140, width: 220, height: 170, title: "素材一", body: "", accent: "#7da9df", mediaUrl: "/api/assets/test-image/content/test.png" },
    { id: 2, kind: "image", x: -450, y: 80, width: 220, height: 170, title: "素材二", body: "", accent: "#7da9df", mediaUrl: "/api/assets/test-image/content/test.png" },
    { id: 3, kind: "video", role: "generator", x: -80, y: -100, width: 300, height: 240, title: "视频生成", body: "测试", accent: "#7da9df", videoSettings: { seconds: "5", resolution: "720p", aspectRatio: "16:9", referenceMode: "references" } },
  );
  canvas.links.splice(0, canvas.links.length,
    { from: 1, to: 3, fromSide: "right", toSide: "left", inputOrder: 1 },
    { from: 2, to: 3, fromSide: "right", toSide: "left", inputOrder: 2 },
  );
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await page.mouse.click(710, 390);
  const frames = page.locator(".flow-node.selected .video-storyboard [data-video-reference-source]");
  await expect(frames).toHaveCount(2);
  const first = await frames.nth(0).boundingBox(), second = await frames.nth(1).boundingBox();
  expect(first).toBeTruthy(); expect(second).toBeTruthy();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(frames.nth(0)).toHaveAttribute("data-video-reference-source", "2");
  await expect(frames.nth(1)).toHaveAttribute("data-video-reference-source", "1");
  await expect(frames.nth(0).locator("b")).toHaveText("1");
  await expect(frames.nth(1).locator("b")).toHaveText("2");
});

const snapNode = (id: number, x: number, y: number, width = 100, height = 80) => ({
  id, x, y, width, height, kind: "prompt" as const, title: "", body: "", accent: "",
});

test("single node snapping uses a fixed gap", () => {
  const moving = snapNode(1, 0, 0);
  const target = snapNode(2, 150, 0);
  const result = snapNodeGroup({ moving: [moving], candidates: [target], dx: 40, dy: 0, zoom: 1 });
  expect(result.dx).toBe(45);
  expect(moving.x + moving.width + result.dx).toBe(target.x - NODE_SNAP_GAP);
});

test("DOM connection ports keep a small dot with a larger hit target", () => {
  const style = readFileSync("src/style.css", "utf8");
  const geometry = readFileSync("src/canvas/canvas-geometry-controller.ts", "utf8");
  expect(style).toContain(".node-port { position:absolute; z-index:4; top:50%; width:25px; height:25px");
  expect(style).toContain('.node-port::before { content:""; position:absolute; inset:6px');
  expect(geometry).toContain("hitPort(sx: number, sy: number, radius = 16");
});

test("node snapping ignores positions outside the screen-space threshold", () => {
  const result = snapNodeGroup({ moving: [snapNode(1, 0, 0)], candidates: [snapNode(2, 150, 0)], dx: 10, dy: 0, zoom: 1 });
  expect(result).toEqual({ dx: 10, dy: 0 });
});

test("DOM drag and canvas drag share single-card snapping geometry", () => {
  const nodes = [
    { id: 1, kind: "prompt", x: 0, y: 0, width: 100, height: 100, title: "", body: "", accent: "#fff" },
    { id: 2, kind: "prompt", x: 115, y: 0, width: 100, height: 100, title: "", body: "", accent: "#fff" },
  ];
  positionDraggedNodes({
    nodes,
    origins: new Map([[1, { x: 0, y: 0 }]]),
    dx: 12,
    dy: 0,
    zoom: 1,
  });
  expect(nodes[0].x + nodes[0].width + NODE_SNAP_GAP).toBe(nodes[1].x);
  const lifecycle = readFileSync("src/canvas/dom-pointer-lifecycle.ts", "utf8");
  expect(lifecycle).toContain("positionDraggedNodes({");
});

const projectId = "canvas-stress-project";

test("scrollable labels show complete visible lines without overflow markers", () => {
  const viewport = labelTextViewport("一二三四五六七八九十", 4, 2);
  const lines = viewport.text.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines).toEqual(["一二三四", "五六七八"]);
  expect(viewport.maxScrollLine).toBe(1);
  expect(viewport.text).not.toContain("…");
});

test("generation state never regresses from running to queued", () => {
  expect(
    mergeGenerationState(
      { status: "running", progress: 38 },
      { status: "queued", progress: 0 },
    ),
  ).toEqual({ status: "running", progress: 38, terminal: false });
  expect(
    mergeGenerationState(
      { status: "running", progress: 38 },
      { status: "running", progress: 20 },
    ).progress,
  ).toBe(38);
});

test("transparent image setting adds a mandatory alpha-background constraint", () => {
  const node = {
    id: 1,
    kind: "image" as const,
    x: 0,
    y: 0,
    width: 280,
    height: 220,
    title: "透明素材",
    body: "红色圆形图标",
    accent: "#fff",
    imageSettings: { background: "transparent" },
  };
  const result = composeImageGenerationPrompt(node, node.body, []);
  expect(result.prompt).toContain(TRANSPARENT_BACKGROUND_CONSTRAINT);
  expect(result.prompt.endsWith(TRANSPARENT_BACKGROUND_CONSTRAINT)).toBe(true);
});

test("mobile composer keeps its generate button inside its own footer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { canvas } = await mockApi(page, 1);
  canvas.nodes[0].x = -100;
  canvas.nodes[0].y = -90;
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await page.mouse.click(195, 350);
  const panel = page.locator(".flow-node.selected > .image-config-panel");
  await expect(panel).toBeVisible();
  const footer = panel.locator(".node-composer-footer");
  const button = panel.locator("[data-image-generate]");
  const [footerBox, buttonBox] = await Promise.all([
    footer.boundingBox(),
    button.boundingBox(),
  ]);
  expect(footerBox).toBeTruthy();
  expect(buttonBox).toBeTruthy();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(footerBox!.x);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
    footerBox!.x + footerBox!.width + 1,
  );
});

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
      ...(index === 0
        ? { mediaUrl: "/api/assets/test-image/content/test.png" }
        : {}),
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
    if (
      path === "/api/assets/test-image/thumbnail" ||
      path === "/api/assets/test-image/content/test.png"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: readFileSync("public/brand/viora-mark.png"),
      });
      return;
    }
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

test("startup keeps all unstyled UI out of the first paint", async ({ page }) => {
  await mockApi(page, 20);
  await page.goto("/?canvasPerf=1");
  await expect(page.locator("html")).not.toHaveClass(/app-loading/);
  await expect(page.locator("body")).toHaveClass(/home-mode/);
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator("#notification-modal")).not.toBeVisible();
  const icon = await page.locator(".home-github svg").boundingBox();
  expect(icon?.width).toBeLessThanOrEqual(20);
  expect(icon?.height).toBeLessThanOrEqual(20);
});

test("prompt agent opens the isolated comic studio", async ({ page }) => {
  await mockApi(page, 20);
  await page.goto("/#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await page.locator("#prompt-agent-trigger").click();
  await expect(page.locator(".prompt-agent-panel.open")).toBeVisible();
  await page.locator("[data-agent-mode-trigger]").click();
  await page.locator("[data-agent-comic]").click();
  await expect(page.locator(".comic-studio.open")).toBeVisible();
  await expect(page.locator(".prompt-agent-panel")).toHaveClass(/comic-hidden/);
});

test("an idle Pixi label clamps long text and opens DOM editing on double click", async ({ page }) => {
  const { canvas } = await mockApi(page, 3);
  Object.assign(canvas.nodes[0], {
    kind: "prompt",
    title: "长标签",
    body: "这是一段用于验证标签内容不会越过卡片底部的长文本。".repeat(30),
  });
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.click(460, 350);
  const selectedCopy = page.locator(".flow-node.kind-prompt.selected .node-copy");
  await expect(selectedCopy).toBeHidden();
  const zoomBefore = await page.locator("#zoom-percent").textContent();
  await page.locator('.flow-node.kind-prompt [data-action="zoom-in"]').click();
  await expect(page.locator('.flow-node.kind-prompt')).toHaveCSS("--font-scale", "1.1");
  await page.mouse.dblclick(460, 350);
  const editor = page.locator('.flow-node.kind-prompt .node-copy[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.hover();
  await page.mouse.wheel(0, 180);
  await expect(page.locator("#zoom-percent")).toHaveText(zoomBefore || "100%");
  await editor.fill("双击后可以正常编辑标签内容");
  await editor.press("Control+Enter");
  await expect(editor).not.toBeVisible();
  await page.mouse.dblclick(460, 295);
  const titleEditor = page.locator(
    '.flow-node.kind-prompt .node-label-heading[contenteditable="true"]',
  );
  await expect(titleEditor).toBeVisible();
  await titleEditor.fill("可编辑标题");
  await titleEditor.press("Enter");
  await expect(titleEditor).not.toBeVisible();
});

test("a Pixi image opens the existing preview on double click", async ({ page }) => {
  const { canvas } = await mockApi(page, 1);
  Object.assign(canvas.nodes[0], {
    kind: "image",
    title: "预览图片",
    mediaUrl: "/api/assets/test-image/content/test.png",
  });
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.dblclick(460, 350);
  await expect(page.locator("#asset-preview")).toHaveClass(/open/);
  await expect(page.locator("#preview-name")).toHaveText("预览图片");
  await page.locator("#close-preview").click();
  await page.mouse.click(460, 350);
  await expect(page.locator('.flow-node[data-id="1"].selected')).toHaveCount(1);
  await page.mouse.dblclick(460, 350);
  await expect(page.locator("#asset-preview")).toHaveClass(/open/);
});

test("an empty Pixi image keeps a single aligned icon frame", async ({ page }) => {
  const { canvas } = await mockApi(page, 1);
  Object.assign(canvas.nodes[0], { kind: "image", mediaUrl: undefined });
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll("#canvas-pixi").length)).toBe(1);
});

test("an empty selected image exposes real source actions and guards generation", async ({ page }) => {
  const { canvas } = await mockApi(page, 1);
  Object.assign(canvas.nodes[0], { kind: "image", mediaUrl: undefined, body: "" });
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await page.mouse.click(460, 350);
  const node = page.locator('.flow-node[data-id="1"]');
  await expect(node.locator('[data-action="image-upload"]')).toBeVisible();
  await expect(node.locator('[data-action="image-library"]')).toBeVisible();
  await expect(node.locator('[data-action="generate"]')).toBeDisabled();
  await node.locator('[data-image-field="description"]').fill("冷色清晨的城市天台");
  await expect(node.locator('[data-action="generate"]')).toBeEnabled();
});

test("a queued Pixi image replaces empty actions with progress state", async ({ page }) => {
  const { canvas } = await mockApi(page, 1);
  Object.assign(canvas.nodes[0], {
    kind: "image",
    mediaUrl: undefined,
    status: "running",
    progress: 42,
  });
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll("#canvas-pixi").length)).toBe(1);
});

test("400 nodes stay GPU-virtualized and recover WebGL context", async ({
  page,
}) => {
  const { canvas } = await mockApi(page);
  (canvas.nodes[0] as (typeof canvas.nodes)[number] & { mediaUrl?: string })
    .mediaUrl = "/api/assets/test-image/content/test.png";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const thumbnailLoaded = page.waitForResponse((response) =>
    response.url().includes("/api/assets/test-image/thumbnail"),
  );
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).toHaveClass(/renderer-pixi/);
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await thumbnailLoaded;
  await page.waitForTimeout(250);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({
      path: "test-results/canvas-unselected.png",
      fullPage: true,
    });
  await page.mouse.click(460, 350);
  await expect(page.locator('.flow-node[data-id="1"].selected')).toHaveCount(1);
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
  expect(visibleDomCards).toBe(1);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({
      path: "test-results/canvas-selected.png",
      fullPage: true,
    });
  expect(await page.locator("#node-layer > .flow-node").count()).toBe(1);

  const primaryImage = page.locator('.flow-node[data-id="1"]');
  await primaryImage
    .locator('[data-image-field="description"]')
    .fill("大规模画布生成回归测试");
  await primaryImage.locator("[data-image-generate]").dispatchEvent("click");
  await page.waitForTimeout(120);
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.click(460, 350);
  await expect(primaryImage).toHaveClass(/selected/);

  await page.evaluate(() =>
    (
      window as typeof window & {
        __canvasPerformance?: { reset(): void };
      }
    ).__canvasPerformance?.reset(),
  );

  await page.mouse.move(70, 700);
  await page.mouse.down();
  await page.mouse.move(250, 610, { steps: 24 });
  await expect(page.locator("#node-layer")).toHaveClass(/dom-interaction-suspended/);
  await page.mouse.up();
  // Panning removes the DOM editor while the Pixi selection and its related
  // link highlight remain in renderer state.
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.click(70, 700);
  await expect(page.locator("#node-layer > .flow-node.selected")).toHaveCount(0);

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
  // The Pixi canvas becomes visible before its first interactive frame has
  // necessarily been submitted on software WebGL. Retry the real hit test
  // instead of relying on an arbitrary sleep or weakening the assertion.
  await expect
    .poll(
      async () => {
        await page.mouse.click(460, 350);
        return page.locator(".flow-node.selected").count();
      },
      { timeout: 10_000 },
    )
    .toBe(1);
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
  await expect(page.locator(".canvas-marquee.open")).toBeVisible();
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

test("dropping an output connection on empty canvas creates and connects a compatible card", async ({ page }) => {
  const { syncPayloads } = await mockApi(page, 3, true);
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    await page.mouse.click(460, 350);
    return page.locator(".flow-node.selected").count();
  }, { timeout: 10_000 }).toBe(1);
  const output = page.locator(".flow-node.selected .node-port.output");
  const box = await output.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(760, 610, { steps: 10 });
  await page.mouse.up();
  const menu = page.locator("#quick-node-menu.connection-create");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[data-quick-upload]")).toBeHidden();
  await expect(menu.locator("[data-quick-multi]")).toBeHidden();
  await menu.locator('[data-quick-add="image"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".flow-node")).toHaveCount(4);
  await expect(page.locator(".flow-node.selected")).toHaveCount(0);
  await expect.poll(() => syncPayloads.some((payload) => {
    const serialized = JSON.stringify(payload);
    return serialized.includes('"from":1') && /"to":([4-9]|[1-9]\d+)/.test(serialized);
  })).toBe(true);
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

  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(1);
  await expect(page.locator(".flow-node.kind-tts")).toHaveCount(1);
  await expect(
    page.locator(".flow-node:not(.kind-audio) > .audio-result-panel:visible"),
  ).toHaveCount(0);

  await page.mouse.click(360, 500);
  const generatedImage = page.locator(".flow-node.kind-image");
  await expect(generatedImage).toHaveCount(1);
  await generatedImage
    .locator('[data-image-field="description"]')
    .fill("动漫风夜景城市，固定镜头，无人物、文字或水印。");
  await generatedImage.locator("[data-image-generate]").dispatchEvent("click");
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
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
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await expect(
    page.locator(".flow-node:not(.kind-audio) > .audio-result-panel:visible"),
  ).toHaveCount(0);
  if (process.env.CANVAS_VISUAL_AUDIT)
    await page.screenshot({ path: "test-results/generation-after-pan.png" });

  expect(errors).toEqual([]);
});

test("dragging a Pixi card never mounts its DOM editor on pointer down", async ({ page }) => {
  await mockApi(page, 1);
  await page.goto("/?canvasPerf=1#/canvas");
  await expect(page.locator("#canvas-pixi")).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(460, 350);
  await page.mouse.down();
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.move(560, 410, { steps: 4 });
  await expect(page.locator("#node-layer > .flow-node")).toHaveCount(0);
  await page.mouse.up();
});

test("business rendering is frozen for the complete interaction gesture", () => {
  const source = readFileSync("src/canvas/canvas-paint-coordinator.ts", "utf8");
  expect(source).toContain("if (this.options.interacting())");
  expect(source).toContain("this.options.renderer()?.updateInteraction(snapshot)");
  const branch = source.slice(
    source.indexOf("if (this.options.interacting())"),
    source.indexOf("this.businessRenderPending = false"),
  );
  expect(branch).not.toContain(".render(snapshot)");
});

test("interaction rendering updates card and link geometry together", () => {
  const source = readFileSync("src/canvas/pixi-renderer.ts", "utf8");
  const interaction = source.slice(
    source.indexOf("updateInteraction(snapshot"),
    source.indexOf("private renderLinkGeometry"),
  );
  expect(interaction).toContain("view.container.position.set(node.x, node.y)");
  expect(interaction).toContain("this.renderLinkGeometry(");
});
