import { Application, Container, Graphics } from "pixi.js";
import type {
  CanvasRenderer,
  CanvasRenderSnapshot,
  RenderLink,
  RenderNode,
} from "./renderer";

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
  private readonly world = new Container();
  private readonly links = new Graphics();
  private lost = false;
  private lastSnapshot?: CanvasRenderSnapshot;

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
    this.world.addChild(this.links);
    this.app.stage.addChild(this.world);
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
    this.app.destroy(true, { children: true });
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
