import type { FlowLink, FlowNode } from "./node-types";
import { VIDEO_CARD_LAYOUT } from "./video-card-layout";

export interface VideoReferenceSwap {
  videoId: number;
  sourceId: number;
}

interface VideoReferenceViewOptions {
  element: HTMLElement;
  node: FlowNode;
  nodes: FlowNode[];
  links: FlowLink[];
  onscreen: boolean;
  getSwap: () => VideoReferenceSwap | null;
  setSwap: (selection: VideoReferenceSwap | null) => void;
  escapeHtml: (value: string) => string;
  notify: (message: string, type: "info" | "success", detail?: string) => void;
  scheduleSave: () => void;
  commitHistory: () => void;
  draw: () => void;
  paintImage: (canvas: HTMLCanvasElement, url: string) => void;
}

export function syncVideoReferenceView(options: VideoReferenceViewOptions) {
  const {
    element,
    node,
    nodes,
    links,
    onscreen,
    getSwap,
    setSwap,
    escapeHtml,
    notify,
    scheduleSave,
    commitHistory,
    draw,
    paintImage,
  } = options;
  if (node.kind === "video") {
    const emptyState =
      element.querySelector<HTMLElement>(".image-empty-state")!;
    if (node.role === "result") {
      const content =
        "<span>▶</span><b>正在生成视频</b><small>完成后可在这里双击播放</small>";
      if (emptyState.dataset.renderKey !== "video-result") {
        emptyState.dataset.renderKey = "video-result";
        emptyState.innerHTML = content;
      }
    } else {
      const referenceLinks = links
        .filter((link) => link.to === node.id)
        .map((link) => ({
          link,
          source: nodes.find((item) => item.id === link.from),
        }))
        .filter(
          (item): item is { link: FlowLink; source: FlowNode } =>
            item.source?.kind === "image",
        )
        .sort(
          (left, right) =>
            (left.link.inputOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.link.inputOrder ?? Number.MAX_SAFE_INTEGER) ||
            left.source.y - right.source.y ||
            left.source.x - right.source.x ||
            left.source.id - right.source.id,
        );
      const totalReferences = referenceLinks.length,
        readyReferences = referenceLinks.filter((item) =>
          Boolean(item.source.mediaUrl),
        ).length;
      const agnesKeyframes =
          node.model?.startsWith("agnes-") && totalReferences > 1,
        mode = agnesKeyframes
          ? "关键帧动画"
          : totalReferences > 1
            ? "多图生视频"
            : totalReferences === 1
              ? "图生视频"
              : "文生视频";
      const settings = node.videoSettings ?? {};
      const frames = referenceLinks
        .map(({ source }, index) => {
          const selected =
            getSwap()?.videoId === node.id &&
            getSwap()!.sourceId === source.id;
          return source.mediaUrl
            ? `<i class="has-image${selected ? " swap-selected" : ""}" data-video-reference-source="${source.id}" title="参考图 ${index + 1} · 点击选择交换"><canvas class="reference-image" width="180" height="120" data-reference-url="${escapeHtml(source.mediaUrl)}"></canvas><b>${index + 1}</b></i>`
            : `<i class="is-waiting${selected ? " swap-selected" : ""}" data-video-reference-source="${source.id}" title="参考图 ${index + 1} · 点击选择交换"><span>${index + 1}</span><small>等待</small></i>`;
        })
        .join("");
      const content = `<header class="video-node-heading"><div><b>视频生成</b><small>${mode}${totalReferences ? ` · ${readyReferences} / ${totalReferences} 张已就绪` : ""}</small></div></header><div class="video-storyboard" style="--frame-count:${totalReferences}"${totalReferences ? "" : " hidden"}>${frames}<em>→</em></div><div class="video-node-summary"><em>${settings.seconds ?? "5"} 秒</em><em>${agnesKeyframes || settings.referenceMode === "keyframes" ? "关键帧" : "参考图"}</em><em>${settings.resolution ?? "720p"}</em><em>${settings.aspectRatio ?? "16:9"}</em></div><p>${node.body.trim() ? escapeHtml(node.body.trim()) : totalReferences ? (readyReferences === totalReferences ? "参考图已就绪，在下方描述画面运动" : `正在等待 ${totalReferences - readyReferences} 张参考图完成`) : "连接图片，或直接输入视频描述"}</p>`;
      const renderKey = `video-generator:${content}`;
      if (emptyState.dataset.renderKey !== renderKey) {
        emptyState.dataset.renderKey = renderKey;
        emptyState.innerHTML = content;
      }
      const exchangeReferences = (firstSourceId: number, secondSourceId: number) => {
        if (firstSourceId === secondSourceId) return false;
        const first = links.find(
            (link) => link.to === node.id && link.from === firstSourceId,
          ),
          second = links.find(
            (link) => link.to === node.id && link.from === secondSourceId,
          );
        if (!first || !second) return false;
        referenceLinks.forEach(
          (item, index) => (item.link.inputOrder = index + 1),
        );
        const firstOrder = first.inputOrder!,
          secondOrder = second.inputOrder!;
        first.inputOrder = secondOrder;
        second.inputOrder = firstOrder;
        setSwap(null);
        scheduleSave();
        commitHistory();
        notify(
          `参考图 ${firstOrder} 与参考图 ${secondOrder} 已交换`,
          "success",
        );
        draw();
        return true;
      };
      let draggedSourceId = 0,
        dragStartX = 0,
        dragStartY = 0,
        didDrag = false;
      const referenceAtPoint = (x: number, y: number) =>
        [...emptyState.querySelectorAll<HTMLElement>("[data-video-reference-source]")]
          .find((item) => {
            const rect = item.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          });
      emptyState
        .querySelectorAll<HTMLElement>("[data-video-reference-source]")
        .forEach((frame) => {
          frame.onpointerdown = (event) => {
            event.preventDefault();
            event.stopPropagation();
            draggedSourceId = Number(frame.dataset.videoReferenceSource) || 0;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            didDrag = false;
            frame.setPointerCapture(event.pointerId);
            frame.classList.add("is-dragging");
          };
          frame.onpointermove = (event) => {
            if (!draggedSourceId || !frame.hasPointerCapture(event.pointerId)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!didDrag && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) > 5)
              didDrag = true;
            emptyState
              .querySelectorAll("[data-video-reference-source].drag-over")
              .forEach((item) => item.classList.remove("drag-over"));
            if (!didDrag) return;
            referenceAtPoint(event.clientX, event.clientY)?.classList.add("drag-over");
          };
          frame.onpointerup = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = referenceAtPoint(event.clientX, event.clientY);
            frame.classList.remove("is-dragging");
            emptyState
              .querySelectorAll("[data-video-reference-source].drag-over")
              .forEach((item) => item.classList.remove("drag-over"));
            if (frame.hasPointerCapture(event.pointerId))
              frame.releasePointerCapture(event.pointerId);
            const sourceId = draggedSourceId;
            draggedSourceId = 0;
            if (didDrag && target) {
              exchangeReferences(
                sourceId,
                Number(target.dataset.videoReferenceSource) || 0,
              );
            }
          };
          frame.onpointercancel = () => {
            draggedSourceId = 0;
            didDrag = false;
            frame.classList.remove("is-dragging");
            emptyState
              .querySelectorAll("[data-video-reference-source].drag-over")
              .forEach((item) => item.classList.remove("drag-over"));
          };
          frame.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (didDrag) {
              didDrag = false;
              return;
            }
            const sourceId = Number(frame.dataset.videoReferenceSource);
            if (!sourceId) return;
            if (
              getSwap()?.videoId === node.id &&
              getSwap()!.sourceId === sourceId
            ) {
              setSwap(null);
              notify("已取消素材交换", "info");
              draw();
              return;
            }
            if (
              !getSwap() ||
              getSwap()!.videoId !== node.id
            ) {
              setSwap({ videoId: node.id, sourceId });
              notify(
                `已选择参考图 ${referenceLinks.findIndex((item) => item.source.id === sourceId) + 1}`,
                "info",
                "再点击另一张素材即可交换顺序。",
              );
              draw();
              return;
            }
            if (!exchangeReferences(getSwap()!.sourceId, sourceId)) {
              setSwap(null);
              draw();
            }
          };
        });
      if (onscreen)
        emptyState
          .querySelectorAll<HTMLCanvasElement>("[data-reference-url]")
          .forEach((canvas) => {
            if (canvas.dataset.paintedUrl !== canvas.dataset.referenceUrl) {
              canvas.dataset.paintedUrl = canvas.dataset.referenceUrl;
              paintImage(canvas, canvas.dataset.referenceUrl!);
            }
          });
    }
  }
  
}
