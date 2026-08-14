import type { FlowLink, FlowNode } from "./node-types";

export type OrderedImageReference = { link: FlowLink; source: FlowNode; order: number };

export function orderedImageReferences(
  targetId: number,
  nodes: FlowNode[],
  links: FlowLink[],
  excludedId = 0,
): OrderedImageReference[] {
  return links
    .filter((link) => link.to === targetId && link.from !== excludedId)
    .map((link) => ({ link, source: nodes.find((node) => node.id === link.from) }))
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
    )
    .map((item, index) => ({ ...item, order: index + 1 }));
}

export function exchangeImageReferenceOrder(
  references: OrderedImageReference[],
  firstSourceId: number,
  secondSourceId: number,
) {
  if (firstSourceId === secondSourceId) return false;
  const first = references.find((item) => item.source.id === firstSourceId);
  const second = references.find((item) => item.source.id === secondSourceId);
  if (!first || !second) return false;
  references.forEach((item) => (item.link.inputOrder = item.order));
  first.link.inputOrder = second.order;
  second.link.inputOrder = first.order;
  return true;
}

export function rewriteImageReferenceNumbers(
  prompt: string,
  before: OrderedImageReference[],
  after: OrderedImageReference[],
) {
  let next = prompt;
  before.forEach((item) => {
    const target = after.find((candidate) => candidate.source.id === item.source.id);
    if (!target || target.order === item.order) return;
    const title = escapeRegExp(item.source.title.trim());
    next = next.replace(
      new RegExp(`图${item.order}「${title}」`, "g"),
      `__IMAGE_REFERENCE_${item.source.id}__`,
    );
  });
  after.forEach((item) => {
    next = next.replaceAll(
      `__IMAGE_REFERENCE_${item.source.id}__`,
      `图${item.order}「${item.source.title.trim()}」`,
    );
  });
  return next;
}

export function synchronizeImageReferenceMentions(
  prompt: string,
  mentions: Array<{ sourceId: number; label: string }>,
  references: OrderedImageReference[],
) {
  let next = prompt;
  const synchronized = mentions.flatMap((mention) => {
    const reference = references.find(
      (item) => item.source.id === mention.sourceId,
    );
    if (!reference) return [];
    const label = reference.source.title.trim() || "未命名素材";
    next = next.replace(
      new RegExp(`图\\d+「${escapeRegExp(mention.label)}」`, "g"),
      `图${reference.order}「${label}」`,
    );
    return [{ sourceId: mention.sourceId, label }];
  });
  return { prompt: next, mentions: synchronized };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
