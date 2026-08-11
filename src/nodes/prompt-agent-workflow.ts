import type { Point } from "./node-types";
import type { PromptAgentStep } from "./comic-types";

type WorkflowStage = NonNullable<PromptAgentStep["stage"]>;

export type PromptAgentLayout = {
  positions: Map<number, Point>;
  nextStageRow: (stage: WorkflowStage) => number;
};

const COLUMN_GAP = 350;
const ROW_GAP = 290;

export function planComicWorkflowLayout(
  planned: PromptAgentStep[],
  base: Point,
): PromptAgentLayout {
  const positions = new Map<number, Point>();
  const stageRows: Record<WorkflowStage, number> = {
    character: 0,
    voice: 0,
    prop: 0,
    scene: 0,
    storyboard: 0,
    tts: 0,
    video: 0,
  };
  const nextStageRow = (stage: WorkflowStage) => stageRows[stage]++;
  const storyX = base.x + COLUMN_GAP * 4;
  const videoX = storyX + COLUMN_GAP * 4;
  const assetStages: WorkflowStage[] = ["character", "voice", "prop", "scene"];

  assetStages.forEach((stage, column) => {
    planned.forEach((step, index) => {
      if (step.stage !== stage) return;
      positions.set(index, {
        x: base.x + column * COLUMN_GAP,
        y: base.y + nextStageRow(stage) * ROW_GAP,
      });
    });
  });

  const assigned = new Set<number>();
  const collectStoryboard = (
    index: number,
    found: Set<number>,
    visited = new Set<number>(),
  ) => {
    if (visited.has(index)) return;
    visited.add(index);
    for (const raw of planned[index]?.dependsOn || []) {
      const dependency = Number(raw) - 1;
      if (dependency < 0 || dependency >= index) continue;
      if (planned[dependency]?.stage === "storyboard") found.add(dependency);
      collectStoryboard(dependency, found, visited);
    }
  };

  let workflowY = base.y;
  planned.forEach((step, index) => {
    if (step.stage !== "video" && step.kind !== "video") return;
    const ancestry = new Set<number>();
    collectStoryboard(index, ancestry);
    const chain = [...ancestry]
      .filter((value) => !assigned.has(value))
      .sort((left, right) => left - right);
    chain.forEach((value) => assigned.add(value));
    const rows = Math.max(1, Math.ceil(chain.length / 4));
    chain.forEach((value, chainIndex) => {
      positions.set(value, {
        x: storyX + (chainIndex % 4) * COLUMN_GAP,
        y: workflowY + Math.floor(chainIndex / 4) * ROW_GAP,
      });
    });
    positions.set(index, {
      x: videoX,
      y: workflowY + ((rows - 1) * ROW_GAP) / 2,
    });
    workflowY += rows * ROW_GAP + 70;
  });

  planned.forEach((step, index) => {
    if (step.stage !== "storyboard" || assigned.has(index)) return;
    const positionIndex = nextStageRow("storyboard");
    positions.set(index, {
      x: storyX + (positionIndex % 4) * COLUMN_GAP,
      y: workflowY + Math.floor(positionIndex / 4) * ROW_GAP,
    });
  });
  planned.forEach((step, index) => {
    if (step.stage !== "tts") return;
    positions.set(index, {
      x: videoX + COLUMN_GAP,
      y: base.y + nextStageRow("tts") * ROW_GAP,
    });
  });

  return { positions, nextStageRow };
}

export function promptAgentStepPosition(options: {
  index: number;
  step: PromptAgentStep;
  layout?: "workflow" | "storyboard" | "comic-workflow";
  base: Point;
  comic: PromptAgentLayout;
}): Point {
  const { index, step, layout, base, comic } = options;
  if (layout === "comic-workflow") {
    const stage = step.stage || "storyboard";
    return (
      comic.positions.get(index) || {
        x: base.x + 4 * COLUMN_GAP,
        y: base.y + comic.nextStageRow(stage) * ROW_GAP,
      }
    );
  }
  if (layout === "storyboard") {
    const shotIndex = Math.floor(index / 2);
    return {
      x: base.x + Math.floor(shotIndex / 3) * 900 + (index % 2) * 390,
      y: base.y + (shotIndex % 3) * 300,
    };
  }
  return {
    x: base.x + Math.floor(index / 3) * 390,
    y: base.y + (index % 3) * 270,
  };
}
