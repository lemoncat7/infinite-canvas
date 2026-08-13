import { Application, Container, Graphics, Texture, TilingSprite } from "pixi.js";
import type { CanvasRenderer, CanvasRenderSnapshot, RenderLink, RenderNode } from "./renderer";
import { canvasTheme } from "./canvas-theme";

function port(node: RenderNode, side: RenderLink["fromSide"]) {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "right") return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
}

function control(point: { x: number; y: number }, side: RenderLink["fromSide"], distance: number) {
  if (side === "top") return { x: point.x, y: point.y - distance };
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x - distance, y: point.y };
}

/** WebGL renders only the canvas surface and link geometry. Cards are DOM-owned. */
export class PixiCanvasRenderer implements CanvasRenderer {
  private readonly app = new Application();
  private readonly background = new Graphics();
  private readonly world = new Container();
  private readonly links = new Graphics();
  private readonly activeLinks = new Graphics();
  private readonly interaction = new Graphics();
  private grid?: TilingSprite;
  private lineGrid?: TilingSprite;
  private lastSnapshot?: CanvasRenderSnapshot;
  private backgroundKey = "";
  private linksKey = "";
  private activeLinkTimer = 0;
  private hasActiveLinks = false;
  private activeDashOffset = 0;
  private lost = false;
  private suspended = false;

  async mount(parent: HTMLElement) {
    await this.app.init({
      autoStart: false,
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resolution: Math.min(devicePixelRatio || 1, innerWidth <= 780 ? 1.5 : 2),
      resizeTo: window,
    });
    this.app.canvas.id = "canvas-pixi";
    this.app.canvas.className = "canvas-render-layer";
    parent.prepend(this.app.canvas);
    this.grid = this.createGrid("dots");
    this.lineGrid = this.createGrid("lines");
    this.world.addChild(this.links, this.activeLinks);
    this.app.stage.addChild(this.background, this.grid, this.lineGrid, this.world, this.interaction);
    this.app.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.app.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  render(snapshot: CanvasRenderSnapshot) {
    this.lastSnapshot = snapshot;
    if (this.lost || this.suspended) return;
    this.applyCamera(snapshot.camera);
    this.renderBackground(snapshot);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const linksKey = this.linkGeometryKey(snapshot);
    if (linksKey !== this.linksKey) {
      this.linksKey = linksKey;
      this.renderLinkGeometry(snapshot, byId);
    }
    this.renderPendingConnection(snapshot);
    this.app.renderer.render(this.app.stage);
  }

  /** Gesture hot path updates transforms and link geometry only. */
  updateInteraction(snapshot: CanvasRenderSnapshot) {
    if (this.lost || this.suspended) return;
    this.applyCamera(snapshot.camera);
    this.renderLinkGeometry(snapshot, new Map(snapshot.nodes.map((node) => [node.id, node])));
    this.renderPendingConnection(snapshot);
    this.app.renderer.render(this.app.stage);
  }

  pan(camera: CanvasRenderSnapshot["camera"]) {
    if (this.lost || this.suspended) return;
    this.applyCamera(camera);
    this.app.renderer.render(this.app.stage);
  }

  suspend() {
    this.suspended = true;
    window.clearTimeout(this.activeLinkTimer);
    this.activeLinkTimer = 0;
  }

  resume() {
    this.suspended = false;
    this.setActiveLinkAnimation(this.hasActiveLinks);
    if (this.lastSnapshot) this.render(this.lastSnapshot);
  }

  destroy() {
    window.clearTimeout(this.activeLinkTimer);
    this.app.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.app.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.app.destroy(true, { children: true });
  }

  private createGrid(mode: "dots" | "lines") {
    const tile = document.createElement("canvas"), context = tile.getContext("2d")!;
    tile.width = 42;
    tile.height = 42;
    context.fillStyle = "#fff";
    context.strokeStyle = "#fff";
    context.lineWidth = 1;
    context.beginPath();
    if (mode === "dots") context.arc(21, 21, 1, 0, Math.PI * 2);
    else {
      context.moveTo(0.5, 0); context.lineTo(0.5, 42);
      context.moveTo(0, 0.5); context.lineTo(42, 0.5);
    }
    mode === "dots" ? context.fill() : context.stroke();
    return new TilingSprite({ texture: Texture.from(tile), width: innerWidth, height: innerHeight });
  }

  private applyCamera(camera: CanvasRenderSnapshot["camera"]) {
    this.world.position.set(innerWidth / 2 + camera.x, innerHeight / 2 + camera.y);
    this.world.scale.set(camera.zoom);
    if (this.grid) {
      this.grid.tileScale.set(camera.zoom);
      this.grid.tilePosition.set(innerWidth / 2 + camera.x - 21 * camera.zoom, innerHeight / 2 + camera.y - 21 * camera.zoom);
    }
    if (this.lineGrid) {
      this.lineGrid.tileScale.set(camera.zoom);
      this.lineGrid.tilePosition.set(innerWidth / 2 + camera.x, innerHeight / 2 + camera.y);
    }
  }

  private renderBackground(snapshot: CanvasRenderSnapshot) {
    const palette = canvasTheme(snapshot.dark);
    const key = `${innerWidth}:${innerHeight}:${snapshot.dark}`;
    if (key !== this.backgroundKey) {
      this.backgroundKey = key;
      this.background.clear().rect(0, 0, innerWidth, innerHeight).fill({ color: palette.background });
      for (const grid of [this.grid, this.lineGrid]) if (grid) {
        grid.width = innerWidth;
        grid.height = innerHeight;
        grid.tint = palette.grid;
      }
      if (this.grid) this.grid.alpha = snapshot.dark ? 0.24 : 0.27;
      if (this.lineGrid) this.lineGrid.alpha = snapshot.dark ? 0.105 : 0.13;
    }
    if (this.grid) this.grid.visible = snapshot.backgroundMode === "dots";
    if (this.lineGrid) this.lineGrid.visible = snapshot.backgroundMode === "lines";
  }

  private linkGeometryKey(snapshot: CanvasRenderSnapshot) {
    let hash = 2166136261;
    const mix = (value: number) => { hash ^= value | 0; hash = Math.imul(hash, 16777619); };
    for (const node of snapshot.nodes) {
      mix(node.id); mix(Math.round(node.x * 10)); mix(Math.round(node.y * 10));
      mix(Math.round(node.width * 10)); mix(Math.round(node.height * 10));
      mix(node.status === "queued" || node.status === "running" ? 1 : 0);
    }
    for (const link of snapshot.links) { mix(link.from); mix(link.to); }
    mix(snapshot.selectedId); mix(snapshot.hoveredLinkIndex + 2); mix(snapshot.touchSelectedLinkIndex + 2); mix(snapshot.dark ? 1 : 0);
    return `${hash}:${snapshot.links.length}`;
  }

  private renderLinkGeometry(snapshot: CanvasRenderSnapshot, byId: ReadonlyMap<number, RenderNode>) {
    const palette = canvasTheme(snapshot.dark);
    this.links.clear();
    this.activeLinks.clear();
    let activeCount = 0;
    snapshot.links.forEach((link, index) => {
      const from = byId.get(link.from), to = byId.get(link.to);
      if (!from || !to) return;
      const a = port(from, link.fromSide), b = port(to, link.toSide),
        curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * 0.35),
        ca = control(a, link.fromSide, curve), cb = control(b, link.toSide, curve),
        highlighted = link.from === snapshot.selectedId || link.to === snapshot.selectedId || index === snapshot.hoveredLinkIndex || index === snapshot.touchSelectedLinkIndex,
        active = [from.status, to.status].some((status) => status === "queued" || status === "running");
      if (active) activeCount++;
      const style = {
        color: highlighted ? palette.linkHighlight : palette.link,
        alpha: highlighted ? 0.94 : 0.64,
        width: highlighted ? 3 : 2.25,
      };
      if (active) this.drawDashedBezier(this.activeLinks, a, ca, cb, b, style, this.activeDashOffset);
      else this.links.moveTo(a.x, a.y).bezierCurveTo(ca.x, ca.y, cb.x, cb.y, b.x, b.y).stroke(style);
    });
    this.setActiveLinkAnimation(activeCount > 0);
  }

  private drawDashedBezier(
    graphics: Graphics,
    a: { x: number; y: number },
    ca: { x: number; y: number },
    cb: { x: number; y: number },
    b: { x: number; y: number },
    style: { color: number; alpha: number; width: number },
    offset: number,
  ) {
    const point = (t: number) => {
      const inverse = 1 - t;
      return {
        x: inverse ** 3 * a.x + 3 * inverse ** 2 * t * ca.x + 3 * inverse * t ** 2 * cb.x + t ** 3 * b.x,
        y: inverse ** 3 * a.y + 3 * inverse ** 2 * t * ca.y + 3 * inverse * t ** 2 * cb.y + t ** 3 * b.y,
      };
    };
    const segments = 64;
    const dash = 12;
    const gap = 8;
    const cycle = dash + gap;
    let previous = a;
    let distance = offset % cycle;
    for (let index = 1; index <= segments; index++) {
      const current = point(index / segments);
      const length = Math.hypot(current.x - previous.x, current.y - previous.y);
      const steps = Math.max(1, Math.ceil(length / 4));
      for (let step = 1; step <= steps; step++) {
        const fromRatio = (step - 1) / steps;
        const toRatio = step / steps;
        const from = { x: previous.x + (current.x - previous.x) * fromRatio, y: previous.y + (current.y - previous.y) * fromRatio };
        const to = { x: previous.x + (current.x - previous.x) * toRatio, y: previous.y + (current.y - previous.y) * toRatio };
        if (distance % cycle < dash) graphics.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke(style);
        distance += length / steps;
      }
      previous = current;
    }
  }

  private renderPendingConnection(snapshot: CanvasRenderSnapshot) {
    this.interaction.clear();
    const pending = snapshot.pendingConnection;
    if (!pending) return;
    const distance = Math.max(55, Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y) * 0.3),
      curve = control(pending.from, pending.fromSide, distance), color = canvasTheme(snapshot.dark).pendingLink;
    this.interaction.moveTo(pending.from.x, pending.from.y).quadraticCurveTo(curve.x, curve.y, pending.to.x, pending.to.y).stroke({ color, alpha: 0.96, width: 2.4 });
    if (pending.snapped) this.interaction.circle(pending.to.x, pending.to.y, 11).fill({ color, alpha: 0.18 }).circle(pending.to.x, pending.to.y, 5).fill({ color, alpha: 1 });
  }

  private setActiveLinkAnimation(active: boolean) {
    this.hasActiveLinks = active;
    if (!active) {
      window.clearTimeout(this.activeLinkTimer); this.activeLinkTimer = 0; this.activeLinks.alpha = 1; return;
    }
    if (this.activeLinkTimer || this.suspended || this.lost) return;
    const animate = () => {
      this.activeLinkTimer = -1;
      if (this.suspended || this.lost || !this.hasActiveLinks) return;
      this.activeDashOffset = (this.activeDashOffset - 2.8 + 20) % 20;
      if (this.lastSnapshot) this.renderLinkGeometry(
        this.lastSnapshot,
        new Map(this.lastSnapshot.nodes.map((node) => [node.id, node])),
      );
      this.app.renderer.render(this.app.stage);
      this.activeLinkTimer = window.setTimeout(animate, 80);
    };
    this.activeLinkTimer = window.setTimeout(animate, 80);
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault(); this.lost = true; document.body.classList.add("canvas-context-lost");
  };
  private readonly onContextRestored = () => {
    this.lost = false; this.linksKey = ""; this.backgroundKey = "";
    document.body.classList.remove("canvas-context-lost");
    if (this.lastSnapshot) this.render(this.lastSnapshot);
  };
}
