import type { FlowLink, FlowNode, Point } from "./node-types";
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

export function configurePromptAgentNode(options: {
  node: FlowNode;
  step: PromptAgentStep;
  index: number;
  comicWorkflow: boolean;
  shouldGenerate: boolean;
}) {
  const { node, step, index, comicWorkflow, shouldGenerate } = options;
  const stage = step.stage || "storyboard";
  if (comicWorkflow && step.kind === "image") node.model = "gpt-image-2";
  node.body = step.prompt.trim();
  node.generationPrompt =
    comicWorkflow && step.kind === "image" ? undefined : step.prompt.trim();
  node.title =
    step.title?.trim() ||
    `Agent · ${step.kind === "video" ? "视频" : step.kind === "voice" ? "语音配置" : step.kind === "tts" ? "TTS" : "图像"} ${index + 1}`;

  if (step.kind === "voice") {
    node.voiceSettings = {
      ...(node.voiceSettings || {}),
      providerId: "easyvoice-local",
      voiceId:
        step.voiceId ||
        node.voiceSettings?.voiceId ||
        "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
      defaultSpeed: clamp(Number(step.voiceSpeed) || 1, 0.5, 2),
      pitch: clamp(Number(step.voicePitch) || 0, -50, 50),
      volume: clamp(Number(step.voiceVolume) || 1, 0, 2),
      roleName: step.roleName || "",
      tone: step.voiceProfile || "自然",
    };
  }
  if (comicWorkflow && step.kind === "image") {
    delete node.corePrompt;
    node.promptProfile =
      step.promptProfile ||
      (stage === "character" ||
      stage === "prop" ||
      stage === "scene" ||
      stage === "storyboard"
        ? stage
        : "manual");
    node.styleConstraint = step.styleConstraint;
    node.formConstraint = step.formConstraint;
    node.continuityConstraint = step.continuityConstraint;
    node.crowdConstraint = step.crowdConstraint;
  }
  node.agentAuto = shouldGenerate && step.autoGenerate !== false;
  node.status = node.agentAuto ? "waiting" : "idle";
  if (step.kind === "video") {
    node.videoSettings = {
      ...(node.videoSettings || {}),
      seconds: String(clamp(Number(step.duration) || 5, 3, 8)),
      aspectRatio: validAspectRatio(step.aspectRatio)
        ? String(step.aspectRatio)
        : node.videoSettings?.aspectRatio || "16:9",
      ...(comicWorkflow
        ? { resolution: "480p", referenceMode: "keyframes" as const }
        : {}),
    };
  }
  if (step.kind === "image") {
    const imageSize = comicWorkflow
      ? step.aspectRatio === "9:16"
        ? "864x1536"
        : step.aspectRatio === "1:1"
          ? "1024x1024"
          : "1536x864"
      : node.imageSettings?.size;
    node.imageSettings = {
      ...(node.imageSettings || {}),
      ...(imageSize ? { size: imageSize } : {}),
      quality: "auto",
    };
  }
}

export function resolvePromptAgentInputs(options: {
  step: PromptAgentStep;
  stepIndex: number;
  imageSources: FlowNode[];
  createdNodes: FlowNode[];
  comicWorkflow: boolean;
}): FlowNode[] {
  const { step, stepIndex, imageSources, createdNodes, comicWorkflow } = options;
  const references = (step.referenceIndexes || [])
    .map(Number)
    .filter(
      (value) =>
        Number.isInteger(value) && value >= 1 && value <= imageSources.length,
    )
    .map((value) => imageSources[value - 1]);
  const dependencies = (step.dependsOn || [])
    .map(Number)
    .filter(
      (value) => Number.isInteger(value) && value >= 1 && value <= stepIndex,
    )
    .map((value) => createdNodes[value - 1])
    .filter((node): node is FlowNode => Boolean(node));
  const ordered =
    comicWorkflow && step.kind === "image"
      ? [...dependencies, ...references]
      : [...references, ...dependencies];
  const unique = ordered.filter(
    (source, index, list) =>
      list.findIndex((candidate) => candidate.id === source.id) === index,
  );
  return comicWorkflow && step.kind === "image" ? unique.slice(0, 2) : unique;
}

export function connectPromptAgentInputs(
  target: FlowNode,
  inputs: FlowNode[],
  links: FlowLink[],
) {
  inputs.forEach((source, inputIndex) => {
    if (links.some((link) => link.from === source.id && link.to === target.id))
      return;
    links.push({
      from: source.id,
      to: target.id,
      fromSide: "right",
      toSide: "left",
      inputOrder: inputIndex + 1,
    });
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function validAspectRatio(value: unknown) {
  return ["9:16", "16:9", "1:1", "4:3"].includes(String(value));
}
