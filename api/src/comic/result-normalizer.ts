import {
  compactImagePrompt,
  sanitizeCharacterNamesFromScenePrompt,
} from "../agents/prompt-format.js";
import {
  comicAssetNameMentioned,
  finalizeComicSceneDependencies,
  normalizeComicSceneHierarchy,
  resolveVisibleAnonymousCrowd,
} from "../comic-validation.js";
import { ComicStreamState } from "./stream-state.js";
import { normalizeComicDialogue } from "./validation.js";

import type { FastifyBaseLogger } from "fastify";

export function normalizeComicResult({
  foundation,
  allShots,
  log,
  streamState,
  model,
  visualInputs,
  confirmedBriefTitle,
  duration,
  aspectRatio,
}: {
  foundation: Record<string, unknown>;
  allShots: unknown[];
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  streamState: ComicStreamState;
  model: string;
  visualInputs: string[];
  confirmedBriefTitle: string;
  duration: string;
  aspectRatio: string;
}) {
  const plan = { ...foundation, shots: allShots } as Record<string, unknown>,
    rawShots = Array.isArray(plan.shots) ? plan.shots : [],
    rawCharacters = Array.isArray(plan.characters) ? plan.characters : [];
  log.info(
    {
      model: streamState.usedModel,
      requestedModel: model,
      elapsedMs: Date.now() - streamState.startedAt,
      responseLength: JSON.stringify(plan).length,
    },
    "comic agent response received",
  );
  const characters = rawCharacters.slice(0, 12).map((value) => {
    const character =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const name = String(character.name || "未命名角色").slice(0, 50),
      description = String(character.description || "").slice(0, 800),
      voiceProfile = String(
        character.voiceProfile ||
          character.voice ||
          "自然中文普通话，声线与角色年龄和性格一致，跨镜头保持稳定",
      ).slice(0, 300),
      nonVisual =
        /无实体|没有实体|仅(?:以|通过).*(?:声音|文字|光阵)|旁白|系统之声/.test(
          `${name}${description}`,
        ),
      rawForms = Array.isArray(character.forms)
        ? character.forms
        : Array.isArray(character.variants)
          ? character.variants
          : [],
      forms = rawForms
        .slice(0, 6)
        .map((formValue) => {
          const form =
              formValue && typeof formValue === "object"
                ? (formValue as Record<string, unknown>)
                : {},
            formName = String(form.name || "特殊形态").slice(0, 50),
            formDescription = String(form.description || "").slice(0, 600);
          return {
            name: formName,
            description: formDescription,
            imagePrompt: compactImagePrompt(
              String(
                form.imagePrompt ||
                  `严格参考${name} Base 人物基准图，保持面部、发型、体型和身份一致，只变更为${formName}：${formDescription}。16:9 横向角色设定板，正面、侧面、背面三视图，并展示变化服饰、伤势、装备和饰品局部细节。`,
              ),
              420,
            ),
          };
        })
        .filter(
          (form) => form.name && !/^(?:base|基础|默认|常态)$/i.test(form.name),
        );
    return {
      name,
      description,
      voiceProfile,
      visualAsset: character.visualAsset !== false && !nonVisual,
      imagePrompt: compactImagePrompt(
        String(
          character.imagePrompt ||
            `${name} Base 角色设定板。${description}。16:9 横向排版，同一人物正面、严格侧面、背面三视图；附头部五官发型近景、服装分层、鞋靴、关键装备武器饰品与材质纹理局部放大，纯净中性背景，保持比例和身份完全一致。`,
        ),
        420,
      ),
      forms,
    };
  });
  const rawProps = Array.isArray(plan.props) ? plan.props : [],
    props = rawProps.slice(0, 16).map((value) => {
      const prop =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : {},
        name = String(prop.name || "未命名道具").slice(0, 60),
        description = String(prop.description || "").slice(0, 800);
      return {
        name,
        description,
        imagePrompt: compactImagePrompt(
          String(
            prop.imagePrompt ||
              `${name}道具设定图，${description}，纯背景，材质、尺寸和特征清楚`,
          ),
          160,
        ),
      };
    });
  const scenes = (Array.isArray(plan.scenes) ? plan.scenes : [])
    .slice(0, 24)
    .map((value, index) => {
      const scene =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      return {
        sceneId: String(
          scene.sceneId || scene.id || `scene-${index + 1}`,
        ).slice(0, 80),
        baseSceneId:
          String(scene.baseSceneId || "")
            .trim()
            .slice(0, 80) || undefined,
        variantType: ["base", "area", "state", "time"].includes(
          String(scene.variantType),
        )
          ? (String(scene.variantType) as "base" | "area" | "state" | "time")
          : String(scene.baseSceneId || "").trim()
            ? ("area" as const)
            : ("base" as const),
        name: String(scene.name || `场景 ${index + 1}`).slice(0, 60),
        description: String(scene.description || scene.scene || "").slice(
          0,
          800,
        ),
        imagePrompt: compactImagePrompt(
          String(
            scene.imagePrompt || scene.scenePrompt || scene.description || "",
          ),
          160,
        ),
        propIndexes: [
          ...new Set(
            (Array.isArray(scene.propIndexes) ? scene.propIndexes : [])
              .map(Number)
              .filter(
                (number) =>
                  Number.isInteger(number) &&
                  number >= 1 &&
                  number <= props.length,
              ),
          ),
        ],
        environmentAnchors: (Array.isArray(scene.environmentAnchors)
          ? scene.environmentAnchors
          : []
        )
          .map((item) =>
            String(item || "")
              .trim()
              .slice(0, 80),
          )
          .filter(Boolean)
          .slice(0, 8),
        views: (() => {
          const allowed = new Set(["main", "reverse", "left", "right", "top"]),
            rawViews = (Array.isArray(scene.views) ? scene.views : []).filter(
              (raw) => raw && typeof raw === "object",
            ) as Array<Record<string, unknown>>,
            byId = new Map(
              rawViews
                .filter((view) => allowed.has(String(view.id)))
                .map((view) => [String(view.id), view]),
            ),
            fallbacks = [
              ["main", "主视角", "保持完整空间结构的主建立机位"],
              [
                "reverse",
                "反向视角",
                "相对主视角旋转约180度，展示同一空间反向区域",
              ],
              [
                "top",
                "俯视布局",
                "俯视展示建筑边界、通道与固定道具的准确方位关系",
              ],
            ];
          const result = fallbacks.map(([id, name, prompt]) => {
            const view = byId.get(id) || {};
            return {
              id,
              name: String(view.name || name).slice(0, 30),
              imagePrompt: compactImagePrompt(
                String(view.imagePrompt || prompt),
                120,
              ),
            };
          });
          for (const id of ["left", "right"]) {
            const view = byId.get(id);
            if (view)
              result.push({
                id,
                name: String(
                  view.name || (id === "left" ? "左侧视角" : "右侧视角"),
                ).slice(0, 30),
                imagePrompt: compactImagePrompt(
                  String(view.imagePrompt || "同一空间侧向机位"),
                  120,
                ),
              });
          }
          return result;
        })(),
      };
    });
  normalizeComicSceneHierarchy(scenes);
  const shots = rawShots
    .map((value, index) => {
      const shot =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : {},
        scene = String(shot.scene || "").slice(0, 800),
        storyBeat = String(shot.storyBeat || "").slice(0, 700),
        action = String(shot.action || scene || "").slice(0, 800),
        dialogue = normalizeComicDialogue(shot.dialogue).slice(0, 700),
        imagePrompt = compactImagePrompt(
          String(shot.imagePrompt || scene || ""),
        ),
        explicitCharacters = Array.isArray(shot.characterIndexes)
          ? shot.characterIndexes
              .map(Number)
              .filter(
                (number) =>
                  Number.isInteger(number) &&
                  number >= 1 &&
                  number <= characters.length,
              )
          : [],
        characterEvidence = `${scene}${storyBeat}${action}${dialogue}${imagePrompt}${JSON.stringify(shot.frames || [])}`,
        inferredCharacters = characters
          .map((character, characterIndex) =>
            new RegExp(
              character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            ).test(characterEvidence)
              ? characterIndex + 1
              : 0,
          )
          .filter(Boolean),
        validatedCharacters = explicitCharacters.length
          ? explicitCharacters
          : inferredCharacters,
        rawFrames = Array.isArray(shot.frames) ? shot.frames : [],
        frames = (
          rawFrames.length ? rawFrames : [{ title: "主画面", imagePrompt }]
        )
          .slice(0, 4)
          .map((frameValue, frameIndex) => {
            const frame =
              frameValue && typeof frameValue === "object"
                ? (frameValue as Record<string, unknown>)
                : {};
            const frameEvidence = `${String(frame.title || "")}${String(frame.imagePrompt || "")}${String(frame.inherit || "")}${String(frame.change || "")}`,
              explicitFrameCharacters = Array.isArray(frame.characterIndexes)
                ? frame.characterIndexes
                    .map(Number)
                    .filter(
                      (number) =>
                        Number.isInteger(number) &&
                        validatedCharacters.includes(number),
                    )
                : [],
              inferredFrameCharacters = validatedCharacters.filter((number) =>
                frameEvidence.includes(
                  characters[number - 1]?.name || "\u0000",
                ),
              ),
              frameCharacterIndexes = [
                ...new Set(
                  explicitFrameCharacters.length
                    ? explicitFrameCharacters
                    : rawFrames.length <= 1
                      ? inferredFrameCharacters
                      : [],
                ),
              ],
              explicitFrameProps = Array.isArray(frame.propIndexes)
                ? frame.propIndexes
                    .map(Number)
                    .filter(
                      (number) =>
                        Number.isInteger(number) &&
                        number >= 1 &&
                        number <= props.length,
                    )
                : [],
              inferredFrameProps = props
                .map((prop, propIndex) =>
                  comicAssetNameMentioned(frameEvidence, prop.name)
                    ? propIndex + 1
                    : 0,
                )
                .filter(Boolean),
              framePropIndexes = [
                ...new Set(
                  explicitFrameProps.length
                    ? explicitFrameProps
                    : rawFrames.length <= 1
                      ? inferredFrameProps
                      : [],
                ),
              ],
              frameCharacterForms = (
                Array.isArray(frame.characterForms) ? frame.characterForms : []
              )
                .map((value) => {
                  const selection =
                      value && typeof value === "object"
                        ? (value as Record<string, unknown>)
                        : {},
                    characterIndex = Number(selection.characterIndex),
                    requestedForm = String(selection.form || "").trim(),
                    form = characters[characterIndex - 1]?.forms.find(
                      (item) => item.name === requestedForm,
                    );
                  return form && frameCharacterIndexes.includes(characterIndex)
                    ? { characterIndex, form: form.name }
                    : null;
                })
                .filter(
                  (value): value is { characterIndex: number; form: string } =>
                    Boolean(value),
                );
            return {
              title: String(frame.title || `画面 ${frameIndex + 1}`).slice(
                0,
                60,
              ),
              imagePrompt: compactImagePrompt(
                String(frame.imagePrompt || imagePrompt),
              ),
              keyframe: ["start", "middle", "end"].includes(
                String(frame.keyframe),
              )
                ? String(frame.keyframe)
                : rawFrames.length === 1 || frameIndex === 0
                  ? "start"
                  : frameIndex === rawFrames.length - 1
                    ? "end"
                    : "middle",
              inherit: String(frame.inherit || shot.continuity || "").slice(
                0,
                240,
              ),
              change: String(
                frame.change || frame.imagePrompt || action || "",
              ).slice(0, 240),
              lock: String(
                frame.lock ||
                  "人物身份、服饰形态、关键道具、空间方向与统一画风保持不变",
              ).slice(0, 240),
              characterIndexes: frameCharacterIndexes,
              characterForms: frameCharacterForms,
              propIndexes: framePropIndexes,
            };
          })
          .filter((frame) => frame.imagePrompt),
        // Re-evaluate the final packaged plan from visible frame evidence.
        // Never revive a stale model boolean, and never treat exclusions
        // such as `无群众` or `禁止路人` as positive crowd evidence.
        crowdEvidence = frames
          .map(
            (frame) =>
              `${frame.title} ${frame.imagePrompt} ${frame.inherit} ${frame.change}`,
          )
          .join(" "),
        hasAnonymousCrowd = resolveVisibleAnonymousCrowd(
          shot.hasAnonymousCrowd,
          shot.hasAnonymousCrowd,
          shot.crowdPrompt,
          `${String(shot.storyBeat || "")} ${String(shot.action || "")} ${String(shot.scene || "")} ${crowdEvidence}`,
        ),
        crowdPrompt = hasAnonymousCrowd
          ? compactImagePrompt(
              String(
                shot.crowdPrompt ||
                  `匿名背景人群，个体脸型、发型、年龄、体型、服装与动作各不相同，自然分散，禁止复制任何具名角色`,
              ),
              160,
            )
          : "",
        visibleCharacterIndexes = [
          ...new Set(frames.flatMap((frame) => frame.characterIndexes)),
        ],
        visiblePropIndexes = [
          ...new Set(frames.flatMap((frame) => frame.propIndexes)),
        ];
      const requestedSceneId = String(
          shot.sceneId || `scene-${index + 1}`,
        ).slice(0, 80),
        sceneEvidence = `${scene} ${storyBeat} ${action} ${String(shot.scenePrompt || "")}`,
        canonicalScene =
          scenes.find((item) => item.sceneId === requestedSceneId) ||
          scenes.find(
            (item) =>
              item.name.length >= 2 && sceneEvidence.includes(item.name),
          ),
        sceneId = canonicalScene?.sceneId || requestedSceneId;
      return {
        number: index + 1,
        title: String(shot.title || `镜头 ${index + 1}`).slice(0, 50),
        duration: Math.max(3, Math.min(8, Number(shot.duration) || 5)),
        storyBeat,
        action,
        scene,
        sceneId,
        sceneView: ["main", "reverse", "left", "right", "top"].includes(
          String(shot.sceneView),
        )
          ? String(shot.sceneView)
          : "main",
        scenePrompt: compactImagePrompt(
          sanitizeCharacterNamesFromScenePrompt(
            String(
              canonicalScene?.imagePrompt ||
                shot.scenePrompt ||
                "环境空间结构、陈设、界面与光影，保持统一美术风格",
            ),
            characters.map((character) => character.name),
          ),
          160,
        ),
        characterIndexes: visibleCharacterIndexes,
        propIndexes: visiblePropIndexes,
        hasAnonymousCrowd,
        crowdPrompt,
        dialogue,
        frames,
        imagePrompt: frames[0]?.imagePrompt || imagePrompt,
        videoPrompt: String(shot.videoPrompt || "").slice(0, 800),
        transition: String(shot.transition || "").slice(0, 300),
        continuity: String(shot.continuity || "").slice(0, 500),
        referenceIndexes: Array.isArray(shot.referenceIndexes)
          ? [
              ...new Set(
                shot.referenceIndexes
                  .map(Number)
                  .filter(
                    (number) =>
                      Number.isInteger(number) &&
                      number >= 1 &&
                      number <= visualInputs.length,
                  ),
              ),
            ]
          : [],
      };
    })
    .filter((shot) => shot.frames.length && shot.videoPrompt);
  finalizeComicSceneDependencies(scenes, shots, props);
  shots.forEach((shot, index) => {
    const rawShot =
        rawShots[index] && typeof rawShots[index] === "object"
          ? (rawShots[index] as Record<string, unknown>)
          : {},
      rawForms = Array.isArray(rawShot.characterForms)
        ? rawShot.characterForms
        : [],
      characterForms = rawForms
        .slice(0, 12)
        .map((value) => {
          const selection =
              value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {},
            characterIndex = Number(selection.characterIndex),
            requestedForm = String(
              selection.form || selection.formName || "",
            ).trim(),
            character = characters[characterIndex - 1],
            form = character?.forms.find((item) => item.name === requestedForm);
          return form && shot.characterIndexes.includes(characterIndex)
            ? { characterIndex, form: form.name }
            : null;
        })
        .filter((value): value is { characterIndex: number; form: string } =>
          Boolean(value),
        );
    (
      shot as typeof shot & {
        characterForms: Array<{ characterIndex: number; form: string }>;
      }
    ).characterForms = characterForms;
  });
  if (!shots.length) throw new SyntaxError("missing shots");
  const outline = (Array.isArray(plan.outline) ? plan.outline : [])
    .slice(0, 8)
    .map((value, index) => {
      const item =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      return {
        act: String(item.act || `第 ${index + 1} 幕`).slice(0, 50),
        content: String(item.content || "").slice(0, 1200),
      };
    });
  const result = {
    title: String(confirmedBriefTitle || plan.title || "未命名漫剧").slice(
      0,
      100,
    ),
    logline: String(plan.logline || "").slice(0, 600),
    tone: String(plan.tone || "").slice(0, 300),
    duration:
      duration === "由对话内容推断"
        ? String(
            plan.duration ||
              `${shots.reduce((sum, shot) => sum + shot.duration, 0)} 秒`,
          ).slice(0, 30)
        : duration,
    aspectRatio:
      aspectRatio === "由对话内容推断"
        ? ["9:16", "16:9", "1:1"].includes(String(plan.aspectRatio))
          ? String(plan.aspectRatio)
          : "9:16"
        : aspectRatio,
    characters,
    props,
    scenes,
    outline,
    shots,
    changeSummary: String(plan.changeSummary || "").slice(0, 300),
    model: streamState.usedModel,
  };
  return result;
}
