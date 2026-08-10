import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from "pixi.js";
import type {
  CanvasRenderer,
  CanvasRenderSnapshot,
  RenderLink,
  RenderNode,
} from "./renderer";
import { PixiTextureCache } from "./pixi-texture-cache";

function port(node: RenderNode, side: RenderLink["fromSide"]) {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "right")
    return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === "bottom")
    return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
}

function control(
  point: { x: number; y: number },
  side: RenderLink["fromSide"],
  distance: number,
) {
  if (side === "top") return { x: point.x, y: point.y - distance };
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x - distance, y: point.y };
}

export class PixiCanvasRenderer implements CanvasRenderer {
  private readonly app = new Application();
  private readonly background = new Graphics();
  private grid?: TilingSprite;
  private lineGrid?: TilingSprite;
  private readonly world = new Container();
  private readonly links = new Graphics();
  private readonly activeLinks = new Graphics();
  private readonly interaction = new Graphics();
  private readonly cards = new Container();
  private readonly cardViews = new Map<
    number,
    {
      container: Container;
      shell: Graphics;
      title: Text;
      body: Text;
      media: Sprite;
      mediaUrl?: string;
      mediaRequest: number;
      key: string;
    }
  >();
  private readonly textures = new PixiTextureCache(innerWidth <= 780 ? 12 : 32);
  private lost = false;
  private suspended = false;
  private lastSnapshot?: CanvasRenderSnapshot;
  private backgroundKey = "";
  private linksKey = "";
  private activeLinkTimer = 0;
  private hasActiveLinks = false;

  async mount(parent: HTMLElement) {
    await this.app.init({
      autoStart: false,
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resolution: Math.min(
        devicePixelRatio || 1,
        innerWidth <= 780 ? 1.5 : 2,
      ),
      resizeTo: window,
    });
    this.app.canvas.id = "canvas-pixi";
    this.app.canvas.className = "canvas-render-layer";
    parent.prepend(this.app.canvas);
    const tile = document.createElement("canvas");
    tile.width = 42;
    tile.height = 42;
    const tileContext = tile.getContext("2d")!;
    tileContext.fillStyle = "#fff";
    tileContext.beginPath();
    tileContext.arc(21, 21, 1, 0, Math.PI * 2);
    tileContext.fill();
    const lineTile = document.createElement("canvas");
    lineTile.width = 42;
    lineTile.height = 42;
    const lineContext = lineTile.getContext("2d")!;
    lineContext.strokeStyle = "#fff";
    lineContext.lineWidth = 1;
    lineContext.beginPath();
    lineContext.moveTo(0.5, 0);
    lineContext.lineTo(0.5, 42);
    lineContext.moveTo(0, 0.5);
    lineContext.lineTo(42, 0.5);
    lineContext.stroke();
    this.grid = new TilingSprite({
      texture: Texture.from(tile),
      width: innerWidth,
      height: innerHeight,
    });
    this.lineGrid = new TilingSprite({
      texture: Texture.from(lineTile),
      width: innerWidth,
      height: innerHeight,
    });
    this.world.addChild(this.links, this.activeLinks, this.cards);
    this.app.stage.addChild(
      this.background,
      this.grid,
      this.lineGrid,
      this.world,
      this.interaction,
    );
    this.app.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.app.canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
  }

  render(snapshot: CanvasRenderSnapshot) {
    this.lastSnapshot = snapshot;
    if (this.lost || this.suspended) return;
    this.world.position.set(
      innerWidth / 2 + snapshot.camera.x,
      innerHeight / 2 + snapshot.camera.y,
    );
    this.world.scale.set(snapshot.camera.zoom);
    const backgroundKey = [
      innerWidth,
      innerHeight,
      snapshot.dark,
    ].join(":");
    if (backgroundKey !== this.backgroundKey) {
      this.backgroundKey = backgroundKey;
      this.background
        .clear()
        .rect(0, 0, innerWidth, innerHeight)
        .fill({ color: snapshot.dark ? 0x0b1113 : 0xeef3ef });
      if (this.grid) {
        this.grid.width = innerWidth;
        this.grid.height = innerHeight;
        this.grid.tint = snapshot.dark ? 0x8fc5c5 : 0x4a6f65;
        this.grid.alpha = snapshot.dark ? 0.24 : 0.27;
      }
      if (this.lineGrid) {
        this.lineGrid.width = innerWidth;
        this.lineGrid.height = innerHeight;
        this.lineGrid.tint = snapshot.dark ? 0x8fc5c5 : 0x4a6f65;
        this.lineGrid.alpha = snapshot.dark ? 0.105 : 0.13;
      }
    }
    if (this.grid) {
      this.grid.visible = snapshot.backgroundMode === "dots";
      this.grid.tileScale.set(snapshot.camera.zoom);
      this.grid.tilePosition.set(
        innerWidth / 2 + snapshot.camera.x - 21 * snapshot.camera.zoom,
        innerHeight / 2 + snapshot.camera.y - 21 * snapshot.camera.zoom,
      );
    }
    if (this.lineGrid) {
      this.lineGrid.visible = snapshot.backgroundMode === "lines";
      this.lineGrid.tileScale.set(snapshot.camera.zoom);
      this.lineGrid.tilePosition.set(
        innerWidth / 2 + snapshot.camera.x,
        innerHeight / 2 + snapshot.camera.y,
      );
    }
    this.renderPendingConnection(snapshot);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    let linkHash = 2166136261;
    const mix = (value: number) => {
      linkHash ^= value | 0;
      linkHash = Math.imul(linkHash, 16777619);
    };
    for (const node of snapshot.nodes) {
      mix(node.id);
      mix(Math.round(node.x * 10));
      mix(Math.round(node.y * 10));
      mix(Math.round(node.width * 10));
      mix(Math.round(node.height * 10));
      mix(node.status === "queued" || node.status === "running" ? 1 : 0);
    }
    for (const link of snapshot.links) {
      mix(link.from);
      mix(link.to);
    }
    mix(snapshot.selectedId);
    mix(snapshot.hoveredLinkIndex + 2);
    mix(snapshot.touchSelectedLinkIndex + 2);
    mix(snapshot.dark ? 1 : 0);
    const linksKey = `${linkHash}:${snapshot.links.length}`;
    if (linksKey !== this.linksKey) {
      this.linksKey = linksKey;
      this.links.clear();
      this.activeLinks.clear();
      let activeCount = 0;
      snapshot.links.forEach((link, index) => {
      const from = byId.get(link.from),
        to = byId.get(link.to);
      if (!from || !to) return;
      const a = port(from, link.fromSide),
        b = port(to, link.toSide),
        curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * 0.35),
        ca = control(a, link.fromSide, curve),
        cb = control(b, link.toSide, curve),
        highlighted =
          link.from === snapshot.selectedId ||
          link.to === snapshot.selectedId ||
          index === snapshot.hoveredLinkIndex ||
          index === snapshot.touchSelectedLinkIndex,
        active =
          from.status === "queued" ||
          from.status === "running" ||
          to.status === "queued" ||
          to.status === "running";
      if (active) activeCount++;
      (active ? this.activeLinks : this.links)
        .moveTo(a.x, a.y)
        .bezierCurveTo(ca.x, ca.y, cb.x, cb.y, b.x, b.y)
        .stroke({
          color: highlighted
            ? snapshot.dark
              ? 0x89e8e4
              : 0x186f67
            : snapshot.dark
              ? 0x6fc7c3
              : 0x48897a,
          alpha: highlighted ? 0.94 : 0.64,
          width: highlighted ? 3 : 2.25,
        });
      });
      this.setActiveLinkAnimation(activeCount > 0);
    }
    const selectedIds = new Set(snapshot.selectedIds);
    const offsetX = innerWidth / 2 + snapshot.camera.x,
      offsetY = innerHeight / 2 + snapshot.camera.y,
      activeCardIds = new Set<number>(),
      margin = 520;
    for (const node of snapshot.nodes) {
      const screenX = node.x * snapshot.camera.zoom + offsetX,
        screenY = node.y * snapshot.camera.zoom + offsetY,
        visible =
          screenX + node.width * snapshot.camera.zoom > -margin &&
          screenX < innerWidth + margin &&
          screenY + node.height * snapshot.camera.zoom > -margin &&
          screenY < innerHeight + margin;
      if (!visible) continue;
      activeCardIds.add(node.id);
      let view = this.cardViews.get(node.id);
      if (!view) {
        const container = new Container(),
          shell = new Graphics(),
          title = new Text({
            style: {
              fill: snapshot.dark ? 0xe8efee : 0x25302d,
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
              fontWeight: "600",
            },
          }),
          body = new Text({
            style: {
              fill: snapshot.dark ? 0xa9b8b5 : 0x66736f,
              fontFamily: "system-ui, sans-serif",
              fontSize: 11,
              lineHeight: 16,
              wordWrap: true,
              wordWrapWidth: Math.max(80, node.width - 28),
            },
          }),
          media = new Sprite(Texture.EMPTY);
        title.position.set(14, 13);
        body.position.set(14, 43);
        media.position.set(12, 66);
        media.visible = false;
        container.addChild(shell, media, title, body);
        this.cards.addChild(container);
        view = { container, shell, title, body, media, mediaRequest: 0, key: "" };
        this.cardViews.set(node.id, view);
      }
      view.container.position.set(node.x, node.y);
      view.container.visible = true;
      const mediaUrl = node.mediaUrl ? this.thumbnailUrl(node.mediaUrl) : undefined;
      if (mediaUrl !== view.mediaUrl) {
        this.detachMedia(view);
        if (mediaUrl) {
          view.mediaUrl = mediaUrl;
          const mediaRequest = ++view.mediaRequest;
          void this.textures
            .acquire(mediaUrl)
            .then((texture) => {
              if (
                view?.mediaUrl !== mediaUrl ||
                view.mediaRequest !== mediaRequest ||
                !view.container.visible
              ) return;
              view.media.texture = texture;
              view.media.visible = true;
              view.media.width = Math.max(1, node.width - 24);
              view.media.height = Math.max(1, node.height - 82);
              if (this.lastSnapshot) this.render(this.lastSnapshot);
            })
            .catch(() => {
              if (
                view?.mediaUrl === mediaUrl &&
                view.mediaRequest === mediaRequest
              ) this.detachMedia(view);
            });
        }
      }
      const key = [
        node.width,
        node.height,
        node.title,
        node.body,
        node.status,
        node.progress,
        node.id === snapshot.selectedId,
        selectedIds.has(node.id),
        snapshot.dark,
      ].join("|");
      if (view.key === key) continue;
      view.key = key;
      view.title.text = node.title || "未命名卡片";
      view.body.visible = !node.mediaUrl;
      view.body.text = (node.body || "暂无描述").replace(/\s+/g, " ").slice(0, 92);
      view.body.style.wordWrapWidth = Math.max(80, node.width - 28);
      view.shell
        .clear()
        .roundRect(0, 0, node.width, node.height, 14)
        .fill({ color: snapshot.dark ? 0x121a1c : 0xf7f7f4, alpha: 1 })
        .stroke({
          color:
            node.id === snapshot.selectedId || selectedIds.has(node.id)
              ? node.accent
              : snapshot.dark
                ? 0x344247
                : 0xc9d0cc,
          width:
            node.id === snapshot.selectedId || selectedIds.has(node.id) ? 2 : 1,
        })
        .roundRect(0, 0, node.width, 4, 2)
        .fill({ color: node.accent, alpha: 0.75 })
        .circle(0, node.height / 2, 5)
        .circle(node.width, node.height / 2, 5)
        .fill({
          color:
            node.id === snapshot.selectedId || selectedIds.has(node.id)
              ? node.accent
              : 0x7b8985,
        });
      if (node.status === "queued" || node.status === "running") {
        const progress = Math.max(0, Math.min(100, node.progress || 0));
        view.shell
          .rect(0, node.height - 3, node.width, 3)
          .fill({ color: snapshot.dark ? 0x273337 : 0xe1e7e4 })
          .rect(0, node.height - 3, (node.width * progress) / 100, 3)
          .fill({ color: node.accent });
      }
    }
    for (const [id, view] of this.cardViews)
      if (!activeCardIds.has(id)) {
        this.detachMedia(view);
        view.container.destroy({ children: true });
        this.cardViews.delete(id);
      }
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
    this.app.canvas.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.app.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.textures.clear();
    this.app.destroy(true, { children: true });
  }

  private setActiveLinkAnimation(active: boolean) {
    this.hasActiveLinks = active;
    if (!active) {
      window.clearTimeout(this.activeLinkTimer);
      this.activeLinkTimer = 0;
      this.activeLinks.alpha = 1;
      return;
    }
    if (this.activeLinkTimer || this.suspended || this.lost) return;
    const animate = () => {
      this.activeLinkTimer = 0;
      if (this.suspended || this.lost || !this.hasActiveLinks) return;
      this.activeLinks.alpha =
        0.66 + (Math.sin(performance.now() / 420) + 1) * 0.15;
      this.app.renderer.render(this.app.stage);
      this.activeLinkTimer = window.setTimeout(animate, 80);
    };
    this.activeLinkTimer = window.setTimeout(animate, 80);
  }

  private detachMedia(view: {
    media: Sprite;
    mediaUrl?: string;
    mediaRequest: number;
  }) {
    if (view.mediaUrl) this.textures.release(view.mediaUrl);
    view.mediaUrl = undefined;
    view.mediaRequest++;
    view.media.texture = Texture.EMPTY;
    view.media.visible = false;
  }

  private thumbnailUrl(url: string) {
    return url.replace(
      /^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/,
      "$1/thumbnail",
    );
  }

  private renderPendingConnection(snapshot: CanvasRenderSnapshot) {
    this.interaction.clear();
    const pending = snapshot.pendingConnection;
    if (!pending) return;
    const distance = Math.max(
        55,
        Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y) *
          0.3,
      ),
      curve = control(pending.from, pending.fromSide, distance),
      color = snapshot.dark ? 0x84e2eb : 0x187084;
    this.interaction
      .moveTo(pending.from.x, pending.from.y)
      .quadraticCurveTo(curve.x, curve.y, pending.to.x, pending.to.y)
      .stroke({ color, alpha: 0.96, width: 2.4 });
    if (pending.snapped)
      this.interaction
        .circle(pending.to.x, pending.to.y, 11)
        .fill({ color, alpha: 0.18 })
        .circle(pending.to.x, pending.to.y, 5)
        .fill({ color, alpha: 1 });
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    document.body.classList.add("canvas-context-lost");
  };

  private readonly onContextRestored = () => {
    this.lost = false;
    this.linksKey = "";
    this.backgroundKey = "";
    this.textures.clear();
    for (const view of this.cardViews.values()) {
      this.detachMedia(view);
      view.key = "";
    }
    document.body.classList.remove("canvas-context-lost");
    if (this.lastSnapshot) this.render(this.lastSnapshot);
  };
}
