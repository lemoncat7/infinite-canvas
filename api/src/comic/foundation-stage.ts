import { normalizeComicSceneHierarchy } from "../comic-validation.js";
import { type ComicGenerationCheckpoint } from "./checkpoint-store.js";
import {
  comicAssetPrompt,
  comicSceneViewPrompt,
  comicStoryPrompt,
} from "./prompts.js";
import { createComicStageReader } from "./stage-reader.js";
import { ComicStreamState } from "./stream-state.js";

export async function generateComicFoundation({
  checkpoint,
  readStage,
  content,
  saveCheckpoint,
  emit,
  streamState,
  text,
  rewriteUntilValid,
}: {
  checkpoint: ComicGenerationCheckpoint;
  readStage: ReturnType<typeof createComicStageReader>;
  content: unknown;
  saveCheckpoint: (patch: Partial<ComicGenerationCheckpoint>) => void;
  emit: (value: unknown) => void;
  streamState: ComicStreamState;
  text: string;
  rewriteUntilValid: (
    stage: string,
    value: Record<string, unknown>,
    kind: "assets" | "scenes" | "shots",
    system: string,
    contextText: string,
    progress: number,
    maxTokens: number,
  ) => Promise<Record<string, unknown>>;
}) {
  const storySystem = comicStoryPrompt();
  const story = checkpoint.story
    ? checkpoint.story
    : await readStage("正在生成剧情大纲…", storySystem, content, 2400, 5, 18);
  if (
    !Array.isArray(story.outline) ||
    !story.outline.length ||
    !String(story.title || "").trim()
  )
    throw new SyntaxError("剧情大纲缺少标题或段落");
  if (!checkpoint.story) saveCheckpoint({ story });
  else
    emit({
      type: "progress",
      progress: 18,
      phase: "已恢复剧情大纲检查点",
      receivedBytes: streamState.receivedBytes,
      resumed: true,
    });
  emit({
    type: "progress",
    progress: 19,
    phase: "剧情大纲校验通过",
    receivedBytes: streamState.receivedBytes,
  });
  const assetSystem = comicAssetPrompt();
  const assetText = `已确认创作需求：\n${text}\n\n已校验剧情大纲：\n${JSON.stringify(story)}`;
  const sceneViewSystem = comicSceneViewPrompt();
  let assets = checkpoint.assets
    ? checkpoint.assets
    : await readStage(
        "正在并行生成人物、道具与场景…",
        assetSystem,
        assetText,
        3800,
        20,
        34,
      );
  assets = await rewriteUntilValid(
    "人物与道具设定",
    assets,
    "assets",
    assetSystem,
    assetText,
    34,
    3800,
  );
  if (!Array.isArray(assets.characters) || !assets.characters.length)
    throw new SyntaxError("人物设定为空");
  if (!checkpoint.assets) saveCheckpoint({ assets });
  else
    emit({
      type: "progress",
      progress: 34,
      phase: "已恢复人物与道具检查点",
      receivedBytes: streamState.receivedBytes,
      resumed: true,
    });
  emit({
    type: "progress",
    progress: 35,
    phase: "人物与道具设定校验通过",
    receivedBytes: streamState.receivedBytes,
  });
  const sceneText = `已确认创作需求：\n${text}\n\n已校验剧情大纲：\n${JSON.stringify(story)}\n\n已校验关键道具索引（场景必须引用而不得重新设计）：\n${JSON.stringify(
    (Array.isArray(assets.props) ? assets.props : []).map((raw, index) => {
      const item =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        index: index + 1,
        name: item.name,
        description: item.description,
      };
    }),
  )}`;
  let sceneBible = checkpoint.sceneBible
    ? checkpoint.sceneBible
    : await readStage(
        "正在建立场景与固定道具依赖…",
        sceneViewSystem,
        sceneText,
        2600,
        36,
        48,
      );
  sceneBible = await rewriteUntilValid(
    "场景设定",
    sceneBible,
    "scenes",
    sceneViewSystem,
    sceneText,
    48,
    2600,
  );
  const availableProps = Array.isArray(assets.props) ? assets.props : [];
  sceneBible.scenes = (
    Array.isArray(sceneBible.scenes) ? sceneBible.scenes : []
  ).map((raw, index) => {
    const scene =
      raw && typeof raw === "object"
        ? { ...(raw as Record<string, unknown>) }
        : {};
    const declared = Array.isArray(scene.propIndexes)
      ? scene.propIndexes.map(Number)
      : [];
    scene.propIndexes = [
      ...new Set(
        declared.filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 1 &&
            value <= availableProps.length,
        ),
      ),
    ];
    scene.environmentAnchors = (
      Array.isArray(scene.environmentAnchors) ? scene.environmentAnchors : []
    )
      .map((value) =>
        String(value || "")
          .trim()
          .slice(0, 80),
      )
      .filter(Boolean)
      .slice(0, 8);
    const rawViews = Array.isArray(scene.views) ? scene.views : [],
      viewMap = new Map(
        rawViews.map((raw) => {
          const view =
              raw && typeof raw === "object"
                ? (raw as Record<string, unknown>)
                : {},
            id = String(view.id || "").trim();
          return [id, view] as const;
        }),
      ),
      requiredViews = [
        {
          id: "main",
          name: "主视角",
          fallback: "保持场景完整空间结构的主建立机位",
        },
        {
          id: "reverse",
          name: "反向视角",
          fallback: "相对主视角旋转约180度，展示同一空间反向区域",
        },
        {
          id: "top",
          name: "俯视布局",
          fallback: "俯视展示建筑边界、通道与固定道具的准确方位关系",
        },
      ];
    scene.views = requiredViews.map((fallback) => {
      const view = viewMap.get(fallback.id) || {};
      return {
        id: fallback.id,
        name: String(view.name || fallback.name)
          .trim()
          .slice(0, 30),
        imagePrompt: String(view.imagePrompt || fallback.fallback)
          .trim()
          .slice(0, 120),
      };
    });
    for (const id of ["left", "right"]) {
      const view = viewMap.get(id);
      if (view)
        (scene.views as Array<Record<string, unknown>>).push({
          id,
          name: String(
            view.name || (id === "left" ? "左侧视角" : "右侧视角"),
          ).slice(0, 30),
          imagePrompt: String(view.imagePrompt || "").slice(0, 120),
        });
    }
    scene.sceneId = String(scene.sceneId || scene.id || `scene-${index + 1}`)
      .trim()
      .slice(0, 80);
    scene.baseSceneId =
      String(scene.baseSceneId || "")
        .trim()
        .slice(0, 80) || undefined;
    scene.variantType = ["base", "area", "state", "time"].includes(
      String(scene.variantType),
    )
      ? String(scene.variantType)
      : scene.baseSceneId
        ? "area"
        : "base";
    return scene;
  });
  normalizeComicSceneHierarchy(
    sceneBible.scenes as Array<{
      sceneId: string;
      baseSceneId?: string;
      variantType?: "base" | "area" | "state" | "time";
      imagePrompt: string;
      propIndexes: number[];
      environmentAnchors: string[];
    }>,
  );
  if (!checkpoint.sceneBible) saveCheckpoint({ sceneBible });
  else
    emit({
      type: "progress",
      progress: 48,
      phase: "已恢复场景设定检查点",
      receivedBytes: streamState.receivedBytes,
      resumed: true,
    });
  emit({
    type: "progress",
    progress: 49,
    phase: "场景设定校验通过",
    receivedBytes: streamState.receivedBytes,
  });
  const foundation = {
      ...story,
      ...assets,
      scenes: Array.isArray(sceneBible.scenes) ? sceneBible.scenes : [],
    } as Record<string, unknown>,
    outlineParts = (Array.isArray(story.outline) ? story.outline : []).slice(
      0,
      8,
    ),
    allShots: unknown[] =
      checkpoint.shotPlan && Array.isArray(checkpoint.shots)
        ? [...checkpoint.shots]
        : [];
  return { foundation, outlineParts, allShots };
}
