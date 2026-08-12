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
import { IMAGE_CARD_LAYOUT, imageEmptyLayout } from "../nodes/image-card-layout";
import {
  LABEL_TEXT_LAYOUT,
  labelBodyMetrics,
  labelTextViewport,
} from "../nodes/label-text-layout";

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

function compactVoiceName(value = "") {
  const names: Record<string, string> = {
    "zh-CN-XiaoxiaoNeural": "晓晓 · 温暖女声",
    "zh-CN-YunxiNeural": "云希 · 阳光男声",
  };
  return names[value] || value || "默认中文音色";
}

type CardPresentation = {
  title: string;
  subtitle: string;
  body: string;
  meta: string;
  centered: boolean;
  icon?: string;
};

function cardPresentation(
  node: RenderNode,
  incoming: readonly RenderLink[],
  byId: ReadonlyMap<number, RenderNode>,
): CardPresentation {
  if (node.kind === "image" && !node.mediaUrl)
    return {
      title: "空图节点",
      subtitle: "",
      body: "生成新图片，或复用已有素材",
      meta: "",
      centered: true,
      icon: "▧",
    };
  if (node.kind === "video" && node.role !== "result") {
    const references = incoming
        .map((link) => byId.get(link.from))
        .filter((source) => source?.kind === "image"),
      ready = references.filter((source) => source?.mediaUrl).length,
      agnesKeyframes =
        node.model?.startsWith("agnes-") && references.length > 1,
      mode = agnesKeyframes
        ? "关键帧动画"
        : references.length > 1
          ? "多图生视频"
          : references.length === 1
            ? "图生视频"
            : "文生视频",
      settings = node.videoSettings ?? {};
    return {
      title: "视频生成",
      subtitle: `${mode}${references.length ? ` · ${ready} / ${references.length} 张已就绪` : ""}`,
      body:
        node.body ||
        (references.length
          ? ready === references.length
            ? "参考图已就绪，在下方描述画面运动"
            : `正在等待 ${references.length - ready} 张参考图完成`
          : "连接图片，或直接输入视频描述"),
      meta: `${settings.seconds ?? "5"} 秒 · ${agnesKeyframes || settings.referenceMode === "keyframes" ? "关键帧" : "参考图"} · ${settings.resolution ?? "720p"} · ${settings.aspectRatio ?? "16:9"}`,
      centered: false,
    };
  }
  if (node.kind === "video" && node.role === "result" && !node.mediaUrl)
    return {
      title: "▶  正在生成视频",
      subtitle: "",
      body: "完成后可在这里双击播放",
      meta: "",
      centered: true,
      icon: "▶",
    };
  if (node.kind === "voice") {
    const settings = node.voiceSettings ?? {},
      speed = settings.defaultSpeed ?? 1,
      pitch = settings.pitch ?? 0,
      volume = settings.volume ?? 1;
    return {
      title: settings.roleName?.trim() || "未设置角色",
      subtitle: "固定角色跨镜头声音",
      body: compactVoiceName(settings.voiceId),
      meta: `${speed.toFixed(2).replace(/0$/, "")}× 语速 · ${pitch > 0 ? "+" : ""}${pitch}Hz 音调 · ${Math.round(volume * 100)}% 音量`,
      centered: false,
    };
  }
  if (node.kind === "tts") {
    const voice = incoming
        .map((link) => byId.get(link.from))
        .find((source) => source?.kind === "voice"),
      voiceLabel = voice
        ? `${voice.voiceSettings?.roleName || "角色"} · ${compactVoiceName(voice.voiceSettings?.voiceId)}`
        : "尚未连接角色声音";
    return {
      title: "TTS 文本生成",
      subtitle: voiceLabel,
      body: node.body || "填写这一镜的对白、旁白或系统播报",
      meta: `${node.ttsSettings?.emotion || "中性"} · ${(node.ttsSettings?.format || "mp3").toUpperCase()}`,
      centered: false,
    };
  }
  if (node.kind === "audio")
    return {
      title: node.title || "音频结果",
      subtitle: node.mediaUrl
        ? `${(node.ttsSettings?.format || "mp3").toUpperCase()}${node.ttsSettings?.duration ? ` · ${node.ttsSettings.duration.toFixed(1)} 秒` : ""}`
        : "等待生成",
      body: "▂▅▃▇▆▃▅▂▃▆▇▃▅▂",
      meta: node.mediaUrl ? "双击播放" : "等待音频生成",
      centered: false,
    };
  return {
    title: node.title || "未命名卡片",
    subtitle: "",
    body: node.body || "暂无描述",
    meta: "",
    centered: false,
  };
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
      shadow: Graphics;
      shell: Graphics;
      detail: Graphics;
      mediaMask: Graphics;
      title: Text;
      icon: Text;
      subtitle: Text;
      body: Text;
      meta: Text;
      hint: Text;
      markers: Text[];
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
    const incomingByTarget = new Map<number, RenderLink[]>();
    for (const link of snapshot.links) {
      const incoming = incomingByTarget.get(link.to);
      if (incoming) incoming.push(link);
      else incomingByTarget.set(link.to, [link]);
    }
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
          shadow = new Graphics(),
          shell = new Graphics(),
          detail = new Graphics(),
          mediaMask = new Graphics(),
          title = new Text({
            style: {
              fill: snapshot.dark ? 0xe8efee : 0x25302d,
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
              fontWeight: "600",
            },
          }),
          icon = new Text({
            style: {
              fill: snapshot.dark ? 0xc7d2cf : 0x76817d,
              fontFamily: "system-ui, sans-serif",
              fontSize: 20,
              fontWeight: "500",
            },
          }),
          subtitle = new Text({
            style: {
              fill: snapshot.dark ? 0x8fa09d : 0x78827f,
              fontFamily: "system-ui, sans-serif",
              fontSize: 10,
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
          meta = new Text({
            style: {
              fill: snapshot.dark ? 0xa9b8b5 : 0x66736f,
              fontFamily: "system-ui, sans-serif",
              fontSize: 10,
            },
          }),
          hint = new Text({
            style: {
              fill: snapshot.dark ? 0x8fa09d : 0x78827f,
              fontFamily: "system-ui, sans-serif",
              fontSize: 9,
            },
          }),
          markers = Array.from(
            { length: 3 },
            (_, index) =>
              new Text({
                text: String(index + 1),
                style: {
                  fill: snapshot.dark ? 0xe4e4e7 : 0x3f3f46,
                  fontFamily: "system-ui, sans-serif",
                  fontSize: 15,
                },
              }),
          ),
          media = new Sprite(Texture.EMPTY);
        markers.forEach((marker) => marker.anchor.set(0.5));
        title.position.set(14, 13);
        icon.anchor.set(0.5);
        subtitle.position.set(14, 34);
        body.position.set(14, 58);
        meta.position.set(14, Math.max(58, node.height - 25));
        media.position.set(12, 66);
        media.visible = false;
        media.mask = mediaMask;
        container.addChild(
          shadow,
          shell,
          media,
          detail,
          icon,
          title,
          subtitle,
          body,
          meta,
          hint,
          ...markers,
          mediaMask,
        );
        this.cards.addChild(container);
        view = {
          container,
          shadow,
          shell,
          detail,
          mediaMask,
          title,
          icon,
          subtitle,
          body,
          meta,
          hint,
          markers,
          media,
          mediaRequest: 0,
          key: "",
        };
        this.cardViews.set(node.id, view);
      }
      view.container.position.set(node.x, node.y);
      view.container.visible = true;
      const mediaUrl =
        node.mediaUrl && (node.kind === "image" || node.kind === "video")
          ? this.thumbnailUrl(node.mediaUrl)
          : undefined;
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
              if (this.lastSnapshot) this.render(this.lastSnapshot);
            })
            .catch((error) => {
              if (
                view?.mediaUrl === mediaUrl &&
                view.mediaRequest === mediaRequest
              ) {
                console.warn("[canvas] thumbnail load failed", mediaUrl, error);
                view.media.texture = Texture.EMPTY;
                view.media.visible = false;
              }
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
        node.role,
        node.model,
        node.fontScale,
        node.labelScroll,
        JSON.stringify(node.videoSettings),
        JSON.stringify(node.voiceSettings),
        JSON.stringify(node.ttsSettings),
        node.id === snapshot.selectedId,
        selectedIds.has(node.id),
        view.media.visible,
        snapshot.dark,
      ].join("|");
      if (view.key === key) continue;
      view.key = key;
      const presentation = cardPresentation(
        node,
        incomingByTarget.get(node.id) ?? [],
        byId,
      );
      view.title.text = presentation.title;
      view.icon.text = presentation.icon || "";
      view.subtitle.text = presentation.subtitle;
      view.body.text = presentation.body.replace(/\s+/g, " ").slice(0, 92);
      view.meta.text = presentation.meta;
      view.hint.text = "";
      view.hint.visible = false;
      view.markers.forEach((marker) => (marker.visible = false));
      // Keep the textual card presentation until the asynchronous texture is
      // actually attached. Hiding it merely because a URL exists produces a
      // blank light shell while images decode, reload, or miss the LRU cache.
      const mediaOnly = Boolean(
        mediaUrl && view.media.visible && view.media.texture !== Texture.EMPTY,
      );
      view.mediaMask
        .clear()
        .roundRect(6, 6, Math.max(1, node.width - 12), Math.max(1, node.height - 12), 12)
        .fill({ color: 0xffffff });
      view.media.position.set(mediaOnly ? 6 : 12, mediaOnly ? 6 : 66);
      view.media.width = Math.max(1, node.width - (mediaOnly ? 12 : 24));
      view.media.height = Math.max(1, node.height - (mediaOnly ? 12 : 82));
      view.title.visible = !mediaOnly;
      view.icon.visible = !mediaOnly && Boolean(presentation.icon);
      view.subtitle.visible = !mediaOnly && Boolean(presentation.subtitle);
      view.body.visible = !mediaOnly;
      view.meta.visible = !mediaOnly && Boolean(presentation.meta);
      view.title.anchor.set(presentation.centered ? 0.5 : 0);
      view.body.anchor.set(presentation.centered ? 0.5 : 0);
      view.title.position.set(
        presentation.centered ? node.width / 2 : 14,
        presentation.centered ? node.height / 2 + 3 : 13,
      );
      view.icon.position.set(node.width / 2, node.height / 2 - 36);
      view.subtitle.position.set(14, 34);
      view.body.position.set(
        presentation.centered ? node.width / 2 : 14,
        presentation.centered ? node.height / 2 + 29 : 58,
      );
      view.meta.position.set(14, Math.max(58, node.height - 25));
      view.body.style.wordWrapWidth = Math.max(80, node.width - 28);
      view.detail.clear();
      view.shadow
        .clear()
        .roundRect(0, 7, node.width, node.height, 14)
        .fill({ color: 0x000000, alpha: snapshot.dark ? 0.24 : 0.1 });
      view.shell
        .clear()
        .roundRect(0, 0, node.width, node.height, 14)
        .fill({ color: snapshot.dark ? 0x111a1c : 0xf7f9f8, alpha: 1 })
        .stroke({
          color:
            node.id === snapshot.selectedId || selectedIds.has(node.id)
              ? node.accent
              : snapshot.dark
                ? 0x344247
                : 0xc9d0cc,
          width:
            node.id === snapshot.selectedId || selectedIds.has(node.id) ? 2 : 1,
        });
      // DOM ports are intentionally hidden until interaction. Keeping gray
      // circles and a colored top rail on every Pixi card made the idle state
      // look like a different component rather than the same card renderer.
      if (node.id === snapshot.selectedId || selectedIds.has(node.id))
        view.shell
          .circle(0, node.height / 2, 5)
          .circle(node.width, node.height / 2, 5)
          .fill({ color: node.accent });
      if (!mediaOnly && node.kind === "image" && !node.mediaUrl) {
        const layout = imageEmptyLayout(node.width, node.height);
        view.detail
          .roundRect(
            layout.iconX - IMAGE_CARD_LAYOUT.iconSize / 2,
            layout.iconY - IMAGE_CARD_LAYOUT.iconSize / 2,
            IMAGE_CARD_LAYOUT.iconSize,
            IMAGE_CARD_LAYOUT.iconSize,
            IMAGE_CARD_LAYOUT.iconRadius,
          )
          .fill({
            color: snapshot.dark ? 0xffffff : 0x71807b,
            alpha: snapshot.dark ? 0.045 : 0.07,
          })
          .stroke({
            color: snapshot.dark ? 0x455458 : 0xc5cfcb,
            width: 1,
          });
        view.icon.position.set(layout.iconX, layout.iconY);
        view.icon.style.fontSize = 19;
        view.title.anchor.set(0.5);
        view.title.position.set(layout.centerX, layout.titleY);
        view.title.style.fontSize = 13;
        view.subtitle.visible = false;
        view.body.anchor.set(0.5);
        view.body.position.set(layout.centerX, layout.descriptionY);
        view.body.style.fontSize = 10;
        view.body.style.align = "center";
        view.meta.visible = false;
        view.detail
          .roundRect(
            layout.actionsX,
            layout.actionsY,
            IMAGE_CARD_LAYOUT.uploadWidth,
            IMAGE_CARD_LAYOUT.actionHeight,
            9,
          )
          .roundRect(
            layout.actionsX + IMAGE_CARD_LAYOUT.uploadWidth + IMAGE_CARD_LAYOUT.actionGap,
            layout.actionsY,
            IMAGE_CARD_LAYOUT.libraryWidth,
            IMAGE_CARD_LAYOUT.actionHeight,
            9,
          )
          .fill({ color: snapshot.dark ? 0xffffff : 0x687772, alpha: 0.035 })
          .stroke({
            color: snapshot.dark ? 0x344247 : 0xd2d9d5,
            alpha: 0.9,
            width: 1,
          });
        view.hint.text = "↑  上传          ▦  资产库";
        view.hint.visible = true;
        view.hint.anchor.set(0.5);
        view.hint.position.set(
          layout.centerX,
          layout.actionsY + IMAGE_CARD_LAYOUT.actionHeight / 2,
        );
        view.hint.style.fontSize = 10;
      } else if (!mediaOnly && node.kind === "prompt") {
        const metrics = labelBodyMetrics(node.width, node.height, node.fontScale);
        view.body.text = labelTextViewport(
          node.body || "暂无描述",
          Math.max(8, Math.floor(metrics.contentWidth / metrics.fontSize)),
          metrics.visibleLines,
          node.labelScroll ?? 0,
        ).text;
        view.title.style.fontSize = metrics.titleFontSize;
        view.title.style.lineHeight = metrics.titleLineHeight;
        view.title.style.fontWeight = "700";
        view.title.anchor.set(0);
        view.title.position.set(
          LABEL_TEXT_LAYOUT.horizontalPadding,
          LABEL_TEXT_LAYOUT.titleTop,
        );
        view.subtitle.visible = false;
        view.icon.visible = false;
        view.body.anchor.set(0);
        view.body.position.set(
          LABEL_TEXT_LAYOUT.horizontalPadding,
          LABEL_TEXT_LAYOUT.bodyTop,
        );
        view.body.style.fontSize = metrics.fontSize;
        view.body.style.lineHeight = metrics.lineHeight;
        view.body.style.align = "left";
        view.body.style.breakWords = true;
        view.body.style.whiteSpace = "pre-line";
        view.body.style.wordWrapWidth = metrics.contentWidth;
        view.meta.visible = false;
      } else if (!mediaOnly && node.kind === "video" && node.role !== "result") {
        const frameTop = 65,
          frameGap = 8,
          frameWidth = (node.width - 44 - frameGap * 2) / 3;
        for (let index = 0; index < 3; index++)
          view.detail
            .roundRect(14 + index * (frameWidth + frameGap), frameTop, frameWidth, 72, 10)
            .fill({
              color: snapshot.dark ? 0xffffff : 0x74827d,
              alpha: snapshot.dark ? 0.045 : 0.075,
            })
            .stroke({
              color: snapshot.dark ? 0x58666a : 0xb9c4c0,
              alpha: 0.7,
              width: 1,
            });
        const pillY = frameTop + 85,
          pillWidths = [38, 47, 43, 42],
          pillGap = 7,
          totalPillWidth = pillWidths.reduce((sum, width) => sum + width, 0) + pillGap * 3;
        let pillX = (node.width - totalPillWidth) / 2;
        pillWidths.forEach((width) => {
          view.detail
            .roundRect(pillX, pillY, width, 24, 12)
            .fill({ color: snapshot.dark ? 0xffffff : 0x74827d, alpha: 0.055 })
            .stroke({ color: snapshot.dark ? 0x344247 : 0xd8dfdb, width: 1 });
          pillX += width + pillGap;
        });
        view.detail
          .moveTo(14, node.height - 48)
          .lineTo(node.width - 14, node.height - 48)
          .stroke({
            color: snapshot.dark ? 0x344247 : 0xd8dfdb,
            alpha: 0.72,
            width: 1,
          });
        view.icon.visible = false;
        view.markers.forEach((marker, index) => {
          marker.visible = true;
          marker.position.set(
            14 + frameWidth / 2 + index * (frameWidth + frameGap),
            frameTop + 36,
          );
        });
        view.title.anchor.set(0.5);
        view.title.position.set(node.width / 2, 14);
        view.subtitle.anchor.set(0.5);
        view.subtitle.position.set(node.width / 2, 36);
        view.body.anchor.set(0.5);
        view.body.position.set(node.width / 2, node.height - 28);
        view.body.style.fontSize = 9;
        view.body.style.align = "center";
        view.meta.anchor.set(0.5);
        view.meta.text = `${node.videoSettings?.seconds ?? 5} 秒      ${node.videoSettings?.referenceMode === "keyframes" ? "关键帧" : "参考图"}      ${node.videoSettings?.resolution ?? "720p"}      ${node.videoSettings?.aspectRatio ?? "16:9"}`;
        view.meta.style.fontSize = 9;
        view.meta.position.set(node.width / 2, pillY + 6);
      } else if (!mediaOnly && node.kind === "voice") {
        view.detail
          .moveTo(18, node.height - 48)
          .lineTo(node.width - 18, node.height - 48)
          .stroke({ color: snapshot.dark ? 0x344247 : 0xd8dfdb, width: 1 });
        view.title.anchor.set(0.5);
        view.title.position.set(node.width / 2, 29);
        view.subtitle.anchor.set(0.5);
        view.subtitle.position.set(node.width / 2, 51);
        view.body.anchor.set(0.5);
        view.body.position.set(node.width / 2, 91);
        view.body.style.align = "center";
        view.meta.anchor.set(0.5);
        view.meta.position.set(node.width / 2, 124);
        view.hint.text = "角色声音配置将在关联的 TTS 节点中复用";
        view.hint.visible = true;
        view.hint.anchor.set(0.5);
        view.hint.position.set(node.width / 2, node.height - 24);
      } else if (!mediaOnly && node.kind === "tts") {
        view.detail
          .moveTo(18, node.height - 48)
          .lineTo(node.width - 18, node.height - 48)
          .stroke({ color: snapshot.dark ? 0x344247 : 0xd8dfdb, width: 1 });
        view.title.anchor.set(0.5);
        view.title.position.set(node.width / 2, 24);
        view.subtitle.anchor.set(0.5);
        view.subtitle.position.set(node.width / 2, 48);
        view.body.anchor.set(0.5);
        view.body.position.set(node.width / 2, 96);
        view.body.style.align = "center";
        view.meta.anchor.set(0.5);
        view.meta.position.set(node.width / 2, 124);
        view.hint.text = node.status === "running" ? "正在生成语音" : "连接语音配置卡片后即可生成";
        view.hint.visible = true;
        view.hint.anchor.set(0.5);
        view.hint.position.set(node.width / 2, node.height - 24);
      } else if (!mediaOnly && node.kind === "audio") {
        const centerY = node.height / 2 + 4,
          bars = [12, 26, 18, 38, 30, 16, 34, 22, 42, 20, 31, 14, 27, 18];
        bars.forEach((height, index) =>
          view.detail
            .roundRect(28 + index * 17, centerY - height / 2, 3, height, 2)
            .fill({ color: snapshot.dark ? 0xa8bdc5 : 0x718b95, alpha: 0.82 }),
        );
        view.title.position.set(16, 15);
        view.subtitle.position.set(16, 37);
        view.body.visible = false;
        view.meta.anchor.set(1);
        view.meta.position.set(node.width - 15, node.height - 19);
      }
      if (presentation.meta && !mediaOnly)
        view.shell
          .moveTo(14, node.height - 38)
          .lineTo(node.width - 14, node.height - 38)
          .stroke({
            color: snapshot.dark ? 0x344247 : 0xd8dfdb,
            alpha: 0.72,
            width: 1,
          });
      if (presentation.icon && !mediaOnly)
        view.shell
          .roundRect(node.width / 2 - 21, node.height / 2 - 57, 42, 42, 11)
          .fill({
            color: snapshot.dark ? 0xffffff : 0x66736f,
            alpha: snapshot.dark ? 0.055 : 0.07,
          })
          .stroke({
            color: snapshot.dark ? 0xffffff : 0x66736f,
            alpha: snapshot.dark ? 0.2 : 0.22,
            width: 1,
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
