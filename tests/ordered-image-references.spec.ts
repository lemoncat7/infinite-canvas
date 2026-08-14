import { expect, test } from "@playwright/test";
import type { FlowLink, FlowNode } from "../src/nodes/node-types";
import {
  exchangeImageReferenceOrder,
  orderedImageReferences,
  rewriteImageReferenceNumbers,
  synchronizeImageReferenceMentions,
} from "../src/nodes/ordered-image-references";

const image = (id: number, title: string, x: number, y: number): FlowNode => ({
  id, title, x, y, kind: "image", width: 280, height: 220, body: "", accent: "#fff",
});

test("stored source ids keep mentions aligned after title and order changes", () => {
  const nodes = [image(1, "新场景名", 0, 80), image(2, "林夜", 0, 0), image(3, "目标", 300, 0)];
  const links: FlowLink[] = [
    { from: 1, to: 3, fromSide: "right", toSide: "left", inputOrder: 2 },
    { from: 2, to: 3, fromSide: "right", toSide: "left", inputOrder: 1 },
  ];
  expect(synchronizeImageReferenceMentions(
    "保持图1「旧场景名」",
    [{ sourceId: 1, label: "旧场景名" }],
    orderedImageReferences(3, nodes, links),
  )).toEqual({
    prompt: "保持图2「新场景名」",
    mentions: [{ sourceId: 1, label: "新场景名" }],
  });
});

test("connected image order is the shared source for labels and request inputs", () => {
  const nodes = [image(1, "场景", 0, 80), image(2, "林夜", 0, 0), image(3, "目标", 300, 0)];
  const links: FlowLink[] = [
    { from: 1, to: 3, fromSide: "right", toSide: "left", inputOrder: 2 },
    { from: 2, to: 3, fromSide: "right", toSide: "left", inputOrder: 1 },
  ];
  expect(orderedImageReferences(3, nodes, links).map((item) => item.source.id)).toEqual([2, 1]);
});

test("swapping materials updates link order and existing numbered mentions", () => {
  const nodes = [image(1, "场景", 0, 0), image(2, "林夜", 0, 80), image(3, "目标", 300, 0)];
  const links: FlowLink[] = [
    { from: 1, to: 3, fromSide: "right", toSide: "left", inputOrder: 1 },
    { from: 2, to: 3, fromSide: "right", toSide: "left", inputOrder: 2 },
  ];
  const before = orderedImageReferences(3, nodes, links);
  expect(exchangeImageReferenceOrder(before, 1, 2)).toBe(true);
  const after = orderedImageReferences(3, nodes, links);
  expect(after.map((item) => item.source.id)).toEqual([2, 1]);
  expect(rewriteImageReferenceNumbers("保持图1「场景」，加入图2「林夜」", before, after))
    .toBe("保持图2「场景」，加入图1「林夜」");
});
