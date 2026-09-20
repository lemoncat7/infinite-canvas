import {
  comicCharacterStateTransitionIssues,
  comicPostureTransitionIssue,
  normalizeComicAssetIndexes,
  normalizeComicCharacterStates,
  resolveVisibleAnonymousCrowd,
} from "../comic-validation.js";
import { type ComicGenerationCheckpoint } from "./checkpoint-store.js";
import {
  COMIC_SHOT_BATCH_SIZE,
  comicBatchWindow,
  completedShotCount,
} from "./pipeline-policy.js";
import { comicShotExpansionPrompt, comicShotPlanPrompt } from "./prompts.js";
import {
  comicShotPlanIssues,
  compactComicFoundation,
  normalizeComicShotPlan,
} from "./shot-plan.js";
import { createComicStageReader } from "./stage-reader.js";
import { ComicStreamState } from "./stream-state.js";
import { validateComicStage } from "./validation.js";

import type { FastifyBaseLogger } from "fastify";

export async function generateComicShots({
  checkpoint,
  readStage,
  saveCheckpoint,
  emit,
  streamState,
  text,
  foundation,
  outlineParts,
  allShots,
  log,
  visualInputs,
}: {
  checkpoint: ComicGenerationCheckpoint;
  readStage: ReturnType<typeof createComicStageReader>;
  saveCheckpoint: (patch: Partial<ComicGenerationCheckpoint>) => void;
  emit: (value: unknown) => void;
  streamState: ComicStreamState;
  text: string;
  foundation: Record<string, unknown>;
  outlineParts: unknown[];
  allShots: unknown[];
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  visualInputs: string[];
}) {
  const shotPlanSystem = comicShotPlanPrompt();
  const compactFoundation = compactComicFoundation(foundation);
  const shotPlanText = `创作需求：\n${text}\n\n已校验的紧凑剧情与资产索引：\n${JSON.stringify(compactFoundation)}`;
  let shotPlan = checkpoint.shotPlan
    ? checkpoint.shotPlan
    : await readStage(
        "正在规划完整镜头列表…",
        shotPlanSystem,
        shotPlanText,
        2800,
        50,
        57,
      );
  const normalizeShotPlan = (value: Record<string, unknown>) =>
    normalizeComicShotPlan(value, outlineParts);
  const shotPlanIssues = (value: Record<string, unknown>) =>
    comicShotPlanIssues(value, outlineParts.length, foundation.duration);
  shotPlan = normalizeShotPlan(shotPlan);
  for (let rewrite = 1; rewrite <= 2; rewrite++) {
    const issues = shotPlanIssues(shotPlan);
    if (!issues.length) break;
    log.warn({ issues, rewrite }, "comic shot plan validation issues");
    emit({
      type: "progress",
      progress: 57,
      phase: `镜头规划发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,
      receivedBytes: streamState.receivedBytes,
      rewrite,
    });
    const splitIssue = issues
        .map((issue) => issue.match(/^镜头(\d+)对白预计需\d+秒，必须拆镜$/))
        .find(Boolean),
      splitIndex = splitIssue ? Number(splitIssue[1]) - 1 : -1,
      currentPlanned = Array.isArray(shotPlan.plannedShots)
        ? [...shotPlan.plannedShots]
        : [];
    if (splitIndex >= 0 && currentPlanned[splitIndex]) {
      const neighbors = currentPlanned.slice(
          Math.max(0, splitIndex - 1),
          splitIndex + 2,
        ),
        localRepair = await readStage(
          `镜头 ${splitIndex + 1} 对白拆分中…`,
          `${shotPlanSystem} 本次只拆分指定的一个超时镜头，plannedShots 仅返回替换该镜头的连续子镜头，不得返回邻镜。完整保留原对白、剧情事实和因果，不得删词；每个子镜头对白均需在8秒内自然说完。`,
          `问题：${issues.filter((issue) => issue.startsWith(`镜头${splitIndex + 1}`)).join("\n")}\n\n需要拆分的镜头：\n${JSON.stringify(currentPlanned[splitIndex])}\n\n前后镜头仅供连续性参考：\n${JSON.stringify(neighbors)}\n\n视觉与剧情基座：\n${shotPlanText}`,
          1800,
          57,
          57,
          true,
        ),
        replacements = Array.isArray(localRepair.plannedShots)
          ? localRepair.plannedShots
          : [];
      if (!replacements.length)
        throw new SyntaxError("超时对白镜头拆分返回为空");
      currentPlanned.splice(splitIndex, 1, ...replacements);
      shotPlan = { ...shotPlan, plannedShots: currentPlanned };
    } else {
      shotPlan = await readStage(
        "镜头规划重写中…",
        shotPlanSystem,
        `保持故事事实不变，修复下列问题并返回完整 plannedShots。\n${issues.join("\n")}\n\n原规划：\n${JSON.stringify(shotPlan)}\n\n基座：\n${shotPlanText}`,
        3200,
        57,
        57,
        true,
      );
    }
    shotPlan = normalizeShotPlan(shotPlan);
  }
  const remainingPlanIssues = shotPlanIssues(shotPlan);
  if (remainingPlanIssues.length)
    throw new SyntaxError(
      `镜头规划复检仍有 ${remainingPlanIssues.length} 项不合格`,
    );
  if (!checkpoint.shotPlan)
    saveCheckpoint({ shotPlan, shots: [], completedBatches: 0 });
  else
    emit({
      type: "progress",
      progress: 57,
      phase: "已恢复镜头规划检查点",
      receivedBytes: streamState.receivedBytes,
      resumed: true,
    });
  const plannedShots = (
      Array.isArray(shotPlan.plannedShots) ? shotPlan.plannedShots : []
    ).map((raw, index) => ({
      ...((raw && typeof raw === "object" ? raw : {}) as Record<
        string,
        unknown
      >),
      number: index + 1,
    })),
    totalShots = plannedShots.length;
  emit({
    type: "progress",
    progress: 58,
    phase: `镜头规划校验通过 · 共 ${totalShots} 镜`,
    receivedBytes: streamState.receivedBytes,
    totalShots,
  });
  const shotViewSystem = comicShotExpansionPrompt();
  // Three shots keeps structured responses comfortably below the range in
  // which providers have repeatedly emitted truncated/invalid JSON. Each
  // successful batch is checkpointed, so a retry never discards prior work.
  const shotBatchSize = COMIC_SHOT_BATCH_SIZE,
    batchCount = Math.ceil(totalShots / shotBatchSize);
  let resumeBatch = Math.min(
    batchCount,
    Math.max(0, Number(checkpoint.completedBatches) || 0),
  );
  const expectedResumedShots = completedShotCount(
    resumeBatch,
    totalShots,
    shotBatchSize,
  );
  if (allShots.length !== expectedResumedShots) {
    resumeBatch = 0;
    allShots.splice(0, allShots.length);
    saveCheckpoint({ shotPlan, shots: [], completedBatches: 0 });
  }
  if (resumeBatch > 0)
    emit({
      type: "progress",
      progress: 59 + Math.floor((resumeBatch * 34) / batchCount),
      phase: `已恢复 ${allShots.length}/${totalShots} 个已校验镜头`,
      receivedBytes: streamState.receivedBytes,
      resumed: true,
      totalShots,
      completedShots: allShots.length,
    });
  for (let batchIndex = resumeBatch; batchIndex < batchCount; batchIndex++) {
    const batchWindow = comicBatchWindow(
        plannedShots,
        batchIndex,
        shotBatchSize,
      ),
      expected = batchWindow.expected,
      firstNumber = Number(
        expected[0]?.number || batchIndex * shotBatchSize + 1,
      ),
      lastNumber = Number(expected.at(-1)?.number || firstNumber),
      batchStart = 59 + Math.floor((batchIndex * 34) / batchCount),
      batchEnd = 59 + Math.floor(((batchIndex + 1) * 34) / batchCount),
      previousTail = allShots.slice(-2),
      neighborPlan = batchWindow.neighbors,
      batchText = `本批及相邻镜头规划：\n${JSON.stringify(neighborPlan)}\n\n本批必须详细生成镜头 ${firstNumber}–${lastNumber}/${totalShots}：\n${JSON.stringify(expected)}\n\n上一批最后镜头状态：\n${JSON.stringify(previousTail)}\n\n已校验视觉基座：\n${JSON.stringify(foundation)}`,
      batchContent: unknown = visualInputs.length
        ? [
            { type: "text", text: batchText },
            ...visualInputs.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ]
        : batchText;
    let shotPart = await readStage(
      `正在生成镜头 ${firstNumber}–${lastNumber}/${totalShots}…`,
      shotViewSystem,
      batchContent,
      6200,
      batchStart,
      Math.max(batchStart + 1, batchEnd - 1),
    );
    emit({
      type: "progress",
      progress: Math.max(batchStart, batchEnd - 1),
      phase: `正在校验镜头 ${firstNumber}–${lastNumber}/${totalShots}…`,
      receivedBytes: streamState.receivedBytes,
      totalShots,
      completedShots: allShots.length,
    });
    const normalizeShotBatch = (value: Record<string, unknown>) => {
      const returned = Array.isArray(value.shots) ? value.shots : [],
        byNumber = new Map<number, Record<string, unknown>>();
      returned.forEach((raw) => {
        if (!raw || typeof raw !== "object") return;
        const item = raw as Record<string, unknown>;
        byNumber.set(Number(item.number), item);
      });
      value.shots = expected.map((planItem, index) => {
        const plan = planItem as Record<string, unknown>,
          generated =
            byNumber.get(Number(plan.number)) ||
            (returned[index] && typeof returned[index] === "object"
              ? (returned[index] as Record<string, unknown>)
              : {});
        return {
          ...plan,
          ...generated,
          number: Number(plan.number),
          title: String(generated.title || plan.title || "").trim(),
          duration: Number(plan.duration),
          storyBeat: String(plan.storyBeat || generated.storyBeat || "").trim(),
          sceneId: String(generated.sceneId || plan.sceneId || "").trim(),
          sceneView: ["main", "reverse", "left", "right", "top"].includes(
            String(plan.sceneView),
          )
            ? String(plan.sceneView)
            : "main",
          characterIndexes: Array.isArray(plan.characterIndexes)
            ? plan.characterIndexes
            : [],
          propIndexes: Array.isArray(plan.propIndexes) ? plan.propIndexes : [],
          dialogue: String(
            plan.dialogue || generated.dialogue || "无对白",
          ).trim(),
          transition: String(
            plan.transition || generated.transition || "",
          ).trim(),
          continuity: String(
            plan.continuity || generated.continuity || "",
          ).trim(),
        };
      });
      return value;
    };
    const normalizeFrameReferences = (value: Record<string, unknown>) => {
      const returned = Array.isArray(value.shots) ? value.shots : [],
        foundationCharacters = Array.isArray(foundation.characters)
          ? foundation.characters
          : [],
        foundationProps = Array.isArray(foundation.props)
          ? foundation.props
          : [];
      returned.forEach((rawShot) => {
        if (!rawShot || typeof rawShot !== "object") return;
        const shot = rawShot as Record<string, unknown>,
          frames = Array.isArray(shot.frames) ? shot.frames : [],
          plannedShot = expected.find(
            (item) => Number(item.number) === Number(shot.number),
          ) as Record<string, unknown> | undefined;
        frames.forEach((rawFrame) => {
          if (!rawFrame || typeof rawFrame !== "object") return;
          const frame = rawFrame as Record<string, unknown>,
            characterIndexes = normalizeComicAssetIndexes(
              frame.characterIndexes,
              foundationCharacters.length,
            ),
            propIndexes = normalizeComicAssetIndexes(
              frame.propIndexes,
              foundationProps.length,
            ),
            allowedCharacters = new Set(characterIndexes);
          frame.characterIndexes = characterIndexes;
          frame.propIndexes = propIndexes;
          frame.characterStates = normalizeComicCharacterStates(
            frame.characterStates,
            characterIndexes,
            propIndexes,
          );
          frame.characterForms = (
            Array.isArray(frame.characterForms) ? frame.characterForms : []
          ).filter((raw) => {
            if (!raw || typeof raw !== "object") return false;
            return allowedCharacters.has(
              Number((raw as Record<string, unknown>).characterIndex),
            );
          });
        });
        const visibleCharacterIndexes = new Set<number>(),
          visiblePropIndexes = new Set<number>();
        frames.forEach((rawFrame) => {
          if (!rawFrame || typeof rawFrame !== "object") return;
          const frame = rawFrame as Record<string, unknown>;
          (Array.isArray(frame.characterIndexes)
            ? frame.characterIndexes
            : []
          ).forEach((index) => visibleCharacterIndexes.add(Number(index)));
          (Array.isArray(frame.propIndexes) ? frame.propIndexes : []).forEach(
            (index) => visiblePropIndexes.add(Number(index)),
          );
        });
        // Shot-level dependencies are derived from what is actually visible in
        // its frames. This prevents off-screen dialogue and anonymous crowds
        // from accidentally attaching unrelated character bases.
        shot.characterIndexes = [...visibleCharacterIndexes].filter(
          (index) =>
            Number.isInteger(index) &&
            index >= 1 &&
            index <= foundationCharacters.length,
        );
        shot.propIndexes = [...visiblePropIndexes].filter(
          (index) =>
            Number.isInteger(index) &&
            index >= 1 &&
            index <= foundationProps.length,
        );
        const allowedShotCharacters = new Set(
          shot.characterIndexes as number[],
        );
        shot.characterForms = (
          Array.isArray(shot.characterForms) ? shot.characterForms : []
        ).filter(
          (raw) =>
            raw &&
            typeof raw === "object" &&
            allowedShotCharacters.has(
              Number((raw as Record<string, unknown>).characterIndex),
            ),
        );
        const crowdEvidence = frames
            .map((rawFrame) => {
              if (!rawFrame || typeof rawFrame !== "object") return "";
              const frame = rawFrame as Record<string, unknown>;
              return `${String(frame.title || "")} ${String(frame.imagePrompt || "")} ${String(frame.inherit || "")} ${String(frame.change || "")}`;
            })
            .join(" "),
          hasAnonymousCrowd = resolveVisibleAnonymousCrowd(
            plannedShot?.hasAnonymousCrowd,
            shot.hasAnonymousCrowd,
            shot.crowdPrompt,
            `${String(shot.storyBeat || "")} ${String(shot.action || "")} ${crowdEvidence}`,
          );
        // Anonymous crowd layers are production dependencies. Derive them
        // from visible frame evidence instead of trusting a stray model flag.
        shot.hasAnonymousCrowd = hasAnonymousCrowd;
        shot.crowdPrompt = hasAnonymousCrowd
          ? String(
              shot.crowdPrompt ||
                "匿名背景人群，个体外观与动作不重复，禁止复制具名角色",
            ).trim()
          : "";
      });
      return value;
    };
    shotPart = normalizeFrameReferences(normalizeShotBatch(shotPart));
    const batchIssues = (value: Record<string, unknown>) => {
      const issues = validateComicStage(value, "shots"),
        returned = Array.isArray(value.shots) ? value.shots : [];
      if (returned.length !== expected.length)
        issues.push(`返回 ${returned.length} 镜，预期 ${expected.length} 镜`);
      expected.forEach((planItem, index) => {
        if (
          Number(
            returned[index] && typeof returned[index] === "object"
              ? (returned[index] as Record<string, unknown>).number
              : 0,
          ) !== Number(planItem.number)
        )
          issues.push(
            `第 ${index + 1} 项镜头编号不匹配，预期 ${planItem.number}`,
          );
        const plan = planItem as Record<string, unknown>,
          rawShot =
            returned[index] && typeof returned[index] === "object"
              ? (returned[index] as Record<string, unknown>)
              : null,
          frames =
            rawShot && Array.isArray(rawShot.frames) ? rawShot.frames : [],
          expectedFrameCount = Math.max(
            1,
            Math.min(4, Number(plan.frameCount) || 1),
          ),
          plannedStateChanges = (
            Array.isArray(plan.stateChanges) ? plan.stateChanges : []
          )
            .map((change) => String(change || "").trim())
            .filter(Boolean),
          claimedStateChanges: number[] = [];
        if (frames.length !== expectedFrameCount)
          issues.push(
            `镜头 ${planItem.number} 返回 ${frames.length} 张分镜，规划要求 ${expectedFrameCount} 张`,
          );
        const plannedCharacterIndexes = new Set(
            (Array.isArray(plan.characterIndexes)
              ? plan.characterIndexes
              : []
            ).map(Number),
          ),
          plannedPropIndexes = new Set(
            (Array.isArray(plan.propIndexes) ? plan.propIndexes : []).map(
              Number,
            ),
          ),
          claimedCharacterIndexes = new Set<number>(),
          claimedPropIndexes = new Set<number>();
        frames.forEach((rawFrame, frameIndex) => {
          const frame =
              rawFrame && typeof rawFrame === "object"
                ? (rawFrame as Record<string, unknown>)
                : null,
            label = `镜头 ${planItem.number} 分镜 ${frameIndex + 1}`;
          if (!frame) {
            issues.push(`${label} 数据无效`);
            return;
          }
          for (const field of [
            "stateChangeIndexes",
            "characterIndexes",
            "characterForms",
            "propIndexes",
            "characterStates",
          ] as const)
            if (!Array.isArray(frame[field]))
              issues.push(`${label} 缺少 ${field}`);
          const stateChangeIndexes = Array.isArray(frame.stateChangeIndexes)
              ? frame.stateChangeIndexes.map(Number)
              : [],
            characterIndexes = Array.isArray(frame.characterIndexes)
              ? frame.characterIndexes.map(Number)
              : [],
            propIndexes = Array.isArray(frame.propIndexes)
              ? frame.propIndexes.map(Number)
              : [],
            characterStates = Array.isArray(frame.characterStates)
              ? (frame.characterStates as Record<string, unknown>[])
              : [];
          stateChangeIndexes.forEach((changeIndex) => {
            if (
              !Number.isInteger(changeIndex) ||
              changeIndex < 0 ||
              changeIndex >= plannedStateChanges.length
            )
              issues.push(`${label} stateChangeIndexes 越界: ${changeIndex}`);
            else claimedStateChanges.push(changeIndex);
          });
          if (!String(frame.change || "").trim())
            issues.push(`${label}.change 为空，未落实可见变化`);
          characterIndexes.forEach((characterIndex) => {
            if (
              !Number.isInteger(characterIndex) ||
              !plannedCharacterIndexes.has(characterIndex)
            )
              issues.push(
                `${label} 使用了镜头规划外的角色 ID ${characterIndex}`,
              );
            else claimedCharacterIndexes.add(characterIndex);
          });
          propIndexes.forEach((propIndex) => {
            if (
              !Number.isInteger(propIndex) ||
              !plannedPropIndexes.has(propIndex)
            )
              issues.push(`${label} 使用了镜头规划外的道具 ID ${propIndex}`);
            else claimedPropIndexes.add(propIndex);
          });
          const stateCharacters = new Set<number>();
          characterStates.forEach((state) => {
            const characterIndex = Number(state.characterIndex),
              posture = String(state.posture || ""),
              heldPropIndexes = Array.isArray(state.heldPropIndexes)
                ? state.heldPropIndexes.map(Number)
                : [];
            if (stateCharacters.has(characterIndex))
              issues.push(
                `${label} 角色 ID ${characterIndex} 的 characterStates 重复`,
              );
            stateCharacters.add(characterIndex);
            if (!characterIndexes.includes(characterIndex))
              issues.push(
                `${label} characterStates 含不可见角色 ID ${characterIndex}`,
              );
            if (
              ![
                "standing",
                "walking",
                "crouching",
                "kneeling",
                "sitting",
                "lying",
                "airborne",
                "other",
              ].includes(posture)
            )
              issues.push(`${label} 角色 ID ${characterIndex} posture 无效`);
            if (!String(state.positionAnchor || "").trim())
              issues.push(
                `${label} 角色 ID ${characterIndex} positionAnchor 为空`,
              );
            if (!String(state.facingTarget || "").trim())
              issues.push(
                `${label} 角色 ID ${characterIndex} facingTarget 为空`,
              );
            if (!Array.isArray(state.heldPropIndexes))
              issues.push(
                `${label} 角色 ID ${characterIndex} heldPropIndexes 无效`,
              );
            if (typeof state.transitionAction !== "string")
              issues.push(
                `${label} 角色 ID ${characterIndex} 缺少 transitionAction 字段`,
              );
            heldPropIndexes.forEach((propIndex) => {
              if (!propIndexes.includes(propIndex))
                issues.push(
                  `${label} 角色 ID ${characterIndex} 持有未出镜道具 ID ${propIndex}`,
                );
            });
          });
          characterIndexes.forEach((characterIndex) => {
            if (!stateCharacters.has(characterIndex))
              issues.push(
                `${label} 可见角色 ID ${characterIndex} 缺少 characterStates`,
              );
          });
          const priorShot =
              index > 0 ? returned[index - 1] : previousTail.at(-1),
            priorFrames =
              priorShot &&
              typeof priorShot === "object" &&
              Array.isArray((priorShot as Record<string, unknown>).frames)
                ? ((priorShot as Record<string, unknown>).frames as unknown[])
                : [],
            previousFrame =
              frameIndex > 0 ? frames[frameIndex - 1] : priorFrames.at(-1);
          issues.push(
            ...comicCharacterStateTransitionIssues(
              previousFrame,
              frame,
              Number(planItem.number),
              frameIndex + 1,
            ),
          );
        });
        plannedCharacterIndexes.forEach((characterIndex) => {
          if (!claimedCharacterIndexes.has(characterIndex))
            issues.push(
              `镜头 ${planItem.number} 规划角色 ID ${characterIndex} 未分配到任何分镜`,
            );
        });
        plannedPropIndexes.forEach((propIndex) => {
          if (!claimedPropIndexes.has(propIndex))
            issues.push(
              `镜头 ${planItem.number} 规划道具 ID ${propIndex} 未分配到任何分镜`,
            );
        });
        plannedStateChanges.forEach((change, changeIndex) => {
          const claims = claimedStateChanges.filter(
            (index) => index === changeIndex,
          ).length;
          if (claims === 0)
            issues.push(
              `镜头 ${planItem.number} 遗漏状态变化 ${changeIndex + 1}「${change}」`,
            );
          else if (claims > 1)
            issues.push(
              `镜头 ${planItem.number} 状态变化 ${changeIndex + 1}「${change}」被重复认领 ${claims} 次`,
            );
        });
        const previousShot =
            index > 0 ? returned[index - 1] : previousTail.at(-1),
          postureIssue = comicPostureTransitionIssue(previousShot, rawShot);
        if (postureIssue) issues.push(postureIssue);
      });
      return issues;
    };
    for (let rewrite = 1; rewrite <= 2; rewrite++) {
      const issues = batchIssues(shotPart);
      if (!issues.length) break;
      log.warn(
        { issues, rewrite, firstNumber, lastNumber },
        "comic shot batch validation issues",
      );
      emit({
        type: "progress",
        progress: Math.max(batchStart, batchEnd - 1),
        phase: `镜头 ${firstNumber}–${lastNumber}/${totalShots} 发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,
        receivedBytes: streamState.receivedBytes,
        rewrite,
      });
      const invalidNumbers = new Set<number>();
      for (const issue of issues) {
        const matched = issue.match(/镜头\s*(\d+)/),
          rawNumber = Number(matched?.[1]);
        if (!Number.isInteger(rawNumber)) continue;
        const actual = expected.some(
          (item) => Number(item.number) === rawNumber,
        )
          ? rawNumber
          : rawNumber >= 1 && rawNumber <= expected.length
            ? Number(expected[rawNumber - 1]?.number)
            : 0;
        if (actual) invalidNumbers.add(actual);
      }
      const repairExpected = invalidNumbers.size
        ? expected.filter((item) => invalidNumbers.has(Number(item.number)))
        : expected;
      const repaired = await readStage(
        `镜头 ${[...invalidNumbers].join("、") || `${firstNumber}–${lastNumber}`} 定向重写中…`,
        `${shotViewSystem} 本次只返回指定问题镜头，shots 数组不得包含其他编号。`,
        `只修复下列问题，不得改变其他已通过镜头。\n${issues.join("\n")}\n\n只需返回的镜头规划：\n${JSON.stringify(repairExpected)}\n\n当前完整批次：\n${JSON.stringify(shotPart)}\n\n上一批末镜：\n${JSON.stringify(previousTail)}`,
        Math.min(6200, 1000 + repairExpected.length * 1100),
        Math.max(batchStart, batchEnd - 1),
        Math.max(batchStart, batchEnd - 1),
        true,
      );
      const currentShots = Array.isArray(shotPart.shots)
          ? [...shotPart.shots]
          : [],
        repairedShots = Array.isArray(repaired.shots) ? repaired.shots : [],
        repairedByNumber = new Map(
          repairedShots
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            )
            .map((item) => [Number(item.number), item]),
        );
      shotPart = {
        ...shotPart,
        shots: currentShots.map((item) => {
          const number = Number(
            item && typeof item === "object"
              ? (item as Record<string, unknown>).number
              : 0,
          );
          return repairedByNumber.get(number) || item;
        }),
      };
      shotPart = normalizeFrameReferences(normalizeShotBatch(shotPart));
    }
    const remaining = batchIssues(shotPart);
    if (remaining.length)
      throw new SyntaxError(
        `镜头 ${firstNumber}–${lastNumber} 复检仍有 ${remaining.length} 项不合格`,
      );
    allShots.push(...(Array.isArray(shotPart.shots) ? shotPart.shots : []));
    saveCheckpoint({
      shotPlan,
      shots: allShots,
      completedBatches: batchIndex + 1,
    });
    emit({
      type: "progress",
      progress: batchEnd,
      phase: `镜头 ${firstNumber}–${lastNumber}/${totalShots} 校验通过`,
      receivedBytes: streamState.receivedBytes,
      totalShots,
      completedShots: allShots.length,
    });
  }
  emit({
    type: "progress",
    progress: 94,
    phase: `正在校验 ${Math.max(0, batchCount - 1)} 个批次边界…`,
    receivedBytes: streamState.receivedBytes,
  });
  return { shotPlan, shotBatchSize, batchCount };
}
