import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
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
  private readonly world = new Container();
  private readonly links = new Graphics();
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
  private lastSnapshot?: CanvasRenderSnapshot;
  private backgroundKey = "";

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
    this.world.addChild(this.links, this.cards);
    this.app.stage.addChild(this.background, this.world);
    this.app.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.app.canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
  }

  render(snapshot: CanvasRenderSnapshot) {
    this.lastSnapshot = snapshot;
    if (this.lost) return;
    this.world.position.set(
      innerWidth / 2 + snapshot.camera.x,
      innerHeight / 2 + snapshot.camera.y,
    );
    this.world.scale.set(snapshot.camera.zoom);
    const backgroundKey = [
      innerWidth,
      innerHeight,
      snapshot.dark,
      Math.round(snapshot.camera.x),
      Math.round(snapshot.camera.y),
      Math.round(snapshot.camera.zoom * 1000),
    ].join(":");
    if (backgroundKey !== this.backgroundKey) {
      this.backgroundKey = backgroundKey;
      const gap = Math.max(12, 42 * snapshot.camera.zoom),
        originX =
          ((innerWidth / 2 + snapshot.camera.x) % gap + gap) % gap,
        originY =
          ((innerHeight / 2 + snapshot.camera.y) % gap + gap) % gap;
      this.background
        .clear()
        .rect(0, 0, innerWidth, innerHeight)
        .fill({ color: snapshot.dark ? 0x0b1113 : 0xeef3ef });
      for (let x = originX; x < innerWidth; x += gap)
        for (let y = originY; y < innerHeight; y += gap)
          this.background.circle(x, y, Math.max(0.7, snapshot.camera.zoom));
      this.background.fill({
        color: snapshot.dark ? 0x8fc5c5 : 0x4a6f65,
        alpha: snapshot.dark ? 0.24 : 0.27,
      });
    }
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    this.links.clear();
    for (const link of snapshot.links) {
      const from = byId.get(link.from),
        to = byId.get(link.to);
      if (!from || !to) continue;
      const a = port(from, link.fromSide),
        b = port(to, link.toSide),
        curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * 0.35),
        ca = control(a, link.fromSide, curve),
        cb = control(b, link.toSide, curve),
        highlighted =
          link.from === snapshot.selectedId || link.to === snapshot.selectedId;
      this.links
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
    }
    const live = new Set(snapshot.nodes.map((node) => node.id));
    for (const [id, view] of this.cardViews)
      if (!live.has(id)) {
        this.detachMedia(view);
        view.container.destroy({ children: true });
        this.cardViews.delete(id);
      }
    const offsetX = innerWidth / 2 + snapshot.camera.x,
      offsetY = innerHeight / 2 + snapshot.camera.y;
    for (const node of snapshot.nodes) {
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
      const screenX = node.x * snapshot.camera.zoom + offsetX,
        screenY = node.y * snapshot.camera.zoom + offsetY,
        margin = 520;
      view.container.visible =
        screenX + node.width * snapshot.camera.zoom > -margin &&
        screenX < innerWidth + margin &&
        screenY + node.height * snapshot.camera.zoom > -margin &&
        screenY < innerHeight + margin;
      if (!view.container.visible) {
        this.detachMedia(view);
        continue;
      }
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
            node.id === snapshot.selectedId
              ? node.accent
              : snapshot.dark
                ? 0x344247
                : 0xc9d0cc,
          width: node.id === snapshot.selectedId ? 2 : 1,
        })
        .roundRect(0, 0, node.width, 4, 2)
        .fill({ color: node.accent, alpha: 0.75 })
        .circle(0, node.height / 2, 5)
        .circle(node.width, node.height / 2, 5)
        .fill({
          color: node.id === snapshot.selectedId ? node.accent : 0x7b8985,
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
    this.app.renderer.render(this.app.stage);
  }

  suspend() {
    this.app.stop();
  }

  resume() {
    this.app.start();
    this.app.stop();
  }

  destroy() {
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

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    document.body.classList.add("canvas-context-lost");
  };

  private readonly onContextRestored = () => {
    this.lost = false;
    document.body.classList.remove("canvas-context-lost");
    if (this.lastSnapshot) this.render(this.lastSnapshot);
  };
}
