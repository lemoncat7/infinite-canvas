import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { hydrateGenerationState } from "../src/services/generation";
import { CanvasLoadCoordinator } from "../src/canvas/load-coordinator";
import { removeFailedRestoredResults } from "../src/canvas/restoration";
import type { FlowNode } from "../src/nodes/node-types";

const node = (id: number, extra: Partial<FlowNode> = {}): FlowNode => ({
  id, kind: "image", title: "test", body: "", x: 0, y: 0,
  width: 240, height: 240, accent: "#fff", jobId: `job-${id}`,
  status: "running", ...extra,
});
const result = (id: string) => Response.json({
  id, status: "succeeded", progress: 100, result_url: `/api/assets/${id}/content/test.png`,
});

test("background failure cleanup preserves moved cards and existing media", () => {
  const nodes = [
    node(1, { kind: "video", x: 70, y: 80 }),
    node(2, { kind: "video", role: "result", status: "failed" }),
    node(3, { kind: "video", role: "result", status: "failed", mediaUrl: "/saved.mp4", y: 2000 }),
  ];
  const links = [2, 3].map(to => ({ from: 1, to, fromSide: "right" as const, toSide: "left" as const }));
  expect(removeFailedRestoredResults(nodes, links)).toBe(1);
  expect(nodes.map(n => n.id)).toEqual([1, 3]);
  expect(links.map(l => l.to)).toEqual([3]);
  expect(nodes[0].x).toBe(70);
  expect(nodes[1].y).toBe(2000);
});

test("closed image panels request nothing; open panels use stable thumbnails", async ({ page }) => {
  const bundle = await build({
    stdin: { contents: `export {syncImageNodePanel} from './src/nodes/image-node-sync'; export {createNodeView} from './src/nodes/node-view-factory';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "Audit",
  });
  const requests: string[] = [];
  await page.route("https://canvas-test.invalid/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: '<style>.image-config-panel{display:none}.image-config-panel.open{display:block}</style><main></main>' });
    requests.push(path);
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
  });
  await page.goto("https://canvas-test.invalid/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const closed = await page.evaluate(() => {
    const w = window as any;
    const nodes = [1, 2].map(id => ({ id, kind: "image", title: "test", body: "", x: 0, y: 0, width: 240, height: 240, mediaUrl: `/api/assets/${id}/content/test.png` }));
    const { element } = w.Audit.createNodeView({ node: nodes[1], getNode: () => nodes[1], authUser: null, customApiModels: [], escapeHtml: (v: string) => v, copyPrompt() {} });
    document.querySelector("main")!.append(element);
    const options = { element, node: nodes[1], nodes, links: [{ from: 1, to: 2 }], selected: false, locked: false, normalizePrompt: (v = "") => v, displayModelName: (v: string) => v, renderSubmit() {}, escapeHtml: (v: string) => v };
    w.syncPanel = (selected: boolean) => w.Audit.syncImageNodePanel({ ...options, selected });
    w.syncPanel(false);
    return element.querySelectorAll(".image-config-panel img").length;
  });
  expect(closed).toBe(0);
  expect(requests).toEqual([]);
  await page.evaluate(() => (window as any).syncPanel(true));
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.every(path => path.endsWith("/thumbnail"))).toBe(true);
  expect(await page.evaluate(() => {
    const first = document.querySelector(".image-config-panel img");
    (window as any).syncPanel(true);
    return first === document.querySelector(".image-config-panel img");
  })).toBe(true);
  await page.evaluate(() => (window as any).syncPanel(false));
  await expect(page.locator(".image-config-panel img")).toHaveCount(0);
});

test("recovery skips complete history, deduplicates jobs and bounds concurrency", async () => {
  const original = globalThis.fetch;
  let active = 0, peak = 0;
  const calls: string[] = [], release: Array<() => void> = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => release.push(resolve));
    active--;
    return result(String(input).split("/").at(-1)!);
  };
  try {
    const nodes = [
      ...Array.from({ length: 91 }, (_, i) => node(i, { status: "succeeded", mediaUrl: "/saved.png" })),
      ...[91, 92, 93].map(id => node(id, { status: "failed" })),
      node(94, { status: "canceled" }),
      ...Array.from({ length: 8 }, (_, i) => node(100 + i)),
      node(200, { jobId: "job-100" }),
      node(201, { status: "succeeded" }), // Missing result still needs recovery.
    ];
    const recovered: number[] = [];
    const pending = hydrateGenerationState(nodes, {
      signal: new AbortController().signal, isCurrent: () => true,
      onRecovered: n => { recovered.push(n.id); },
    });
    expect(calls).toHaveLength(4);
    while (recovered.length < 10) {
      release.splice(0).forEach(resolve => resolve());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await pending;
    expect(peak).toBe(4);
    expect(calls).toHaveLength(9);
    expect(new Set(calls).size).toBe(9);
    expect(nodes.at(-1)?.mediaUrl).toContain("job-201");
  } finally { globalThis.fetch = original; }
});

test("late recovery cannot overwrite a switched project, deleted node or newer job", async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  globalThis.fetch = async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return result("job-1");
  };
  try {
    for (const change of ["project", "deleted", "job", "local-edit", "abort"]) {
      const n = node(1), controller = new AbortController();
      let current = true, callbacks = 0;
      const pending = hydrateGenerationState([n], {
        signal: controller.signal, isCurrent: () => current,
        onRecovered: () => { callbacks++; },
      });
      if (change === "project" || change === "deleted") current = false;
      if (change === "job") n.jobId = "new-job";
      if (change === "local-edit") n.mediaUrl = "/replacement.png";
      if (change === "abort") controller.abort();
      release();
      await pending;
      expect(n.status).toBe("running");
      expect(callbacks).toBe(0);
    }
  } finally { globalThis.fetch = original; }
});

test("failed status refresh preserves saved state and hands active tasks back to polling", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const n = node(1), callbacks: boolean[] = [];
    await hydrateGenerationState([n], {
      signal: new AbortController().signal, isCurrent: () => true,
      onRecovered: (current, changed) => { expect(current.status).toBe("running"); callbacks.push(changed); },
    });
    expect(callbacks).toEqual([false]);
  } finally { globalThis.fetch = original; }
});

test("a stalled recovery request times out and preserves the node for polling", async () => {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  let timeoutMs = 0, callbacks = 0;
  AbortSignal.timeout = ms => { timeoutMs = ms; return originalTimeout(5); };
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  });
  try {
    const n = node(1);
    await hydrateGenerationState([n], {
      signal: new AbortController().signal, isCurrent: () => true,
      onRecovered: () => { callbacks++; },
    });
    expect(timeoutMs).toBe(10_000);
    expect(n.status).toBe("running");
    expect(callbacks).toBe(1);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});

test("canvas load draws saved nodes before a slow job responds", async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  globalThis.fetch = async input => {
    if (String(input).endsWith("/canvas")) return Response.json({ version: 1, nodes: [node(1)], links: [] });
    await new Promise<void>(resolve => { release = resolve; });
    return result("job-1");
  };
  try {
    const nodes: FlowNode[] = [], events: string[] = [];
    const noop = () => {};
    const coordinator = new CanvasLoadCoordinator({
      save: { beginLoad: () => 1, isCurrentLoad: () => true, completeLoad: noop } as any,
      nodes, links: [], camera: { x: 0, y: 0, zoom: 1 }, projectId: () => "test",
      normalizePrompt: value => value, clearViews: noop, cancelPolling: noop,
      getLease: () => ({ nextId: 2, end: 100 }), restoreLease: noop, resetLease: noop,
      needsLease: () => false, reserveIds: async () => true, syncCamera: noop,
      setBootStatus: () => 1, hideBootStatus: noop, hideConflictGuide: noop,
      clearSelection: noop, setSavedState: noop, setOfflineState: () => events.push("offline"),
      update: noop, draw: () => events.push("draw"), resetHistory: noop,
      capture: () => ({ nodes, links: [], camera: { x: 0, y: 0, zoom: 1 }, version: 1, updatedAt: "" }),
      scheduleSave: () => events.push("save"), pollJob: () => events.push("poll"),
      runAgentWorkflow: () => events.push("workflow"),
    });
    await coordinator.load();
    expect(events).toContain("draw");
    expect(events).not.toContain("workflow");
    expect(nodes[0].status).toBe("running");
    release();
    await expect.poll(() => nodes[0].status).toBe("succeeded");
    expect(nodes[0].mediaUrl).toContain("job-1");
    expect(events).toContain("save");
    expect(events).toContain("workflow");
    expect(events).not.toContain("offline");
  } finally { globalThis.fetch = original; }
});
