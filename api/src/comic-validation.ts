const crowdTerm =
  "(?:匿名(?:背景)?(?:人物|人群|群众)|背景(?:人物|人群|群众)|路人群众|围观群众|群众|人群|路人|围观者|修士们?|弟子们?)";
const negativeCrowd = new RegExp(
  `(?:无|禁止|不得|不出现|没有|不包含)[^。；,，]{0,20}${crowdTerm}`,
  "g",
);
const positiveCrowd =
  /(?:匿名背景(?:人物|人群)|匿名(?:修士|宾客|买家|竞买者)?观众|背景人群|围观群众|路人群|修士人群|众修士|弟子们|席间修士|观众席[^。；,，]{0,12}(?:坐满|聚集|落座|观看|后退))|(?:群众|人群|路人|围观者|观众|宾客|买家|竞买者|修士们|弟子们)[^。；,，]{0,16}(?:聚集|围观|分散|站立|落座|奔跑|后退|惊呼|交谈|涌入)/;

/**
 * This is a transport/validation capacity, not a requested shot count. The
 * story model remains responsible for choosing the natural number of shots.
 * Using the upper end of a duration range prevents a valid long-form plan (or
 * a dialogue split that adds a shot) from being rejected by a short-form
 * constant.
 */
export function comicShotCapacity(duration: unknown) {
  const text = String(duration || "").trim().toLowerCase(),
    values = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])),
    upper = values.length ? Math.max(...values.filter(Number.isFinite)) : 0;
  let seconds = 0;
  if (/分钟|mins?|minutes?/.test(text)) seconds = upper * 60;
  else if (/秒|secs?|seconds?/.test(text)) seconds = upper;
  // Four seconds per shot is deliberately conservative: production shots are
  // 3–8 seconds, and splitting an overlong line must be allowed to add shots.
  return seconds > 0
    ? Math.max(24, Math.min(160, Math.ceil(seconds / 4)))
    : 96;
}

type PostureShot = {
  number?: unknown;
  action?: unknown;
  videoPrompt?: unknown;
  characterIndexes?: unknown;
  frames?: unknown;
};

const postureRules = [
  { state: "kneeling", label: "跪姿", pose: /跪(?:下|地|在)|单膝跪|双膝跪/, transition: /跪下|屈膝跪|单膝落地/ },
  { state: "crouching", label: "蹲伏/俯身", pose: /蹲(?:下|着|在)|半蹲|俯身|弯腰|伏低|压低身体/, transition: /蹲下|半蹲|俯身|弯腰|屈膝|伏低|压低身体/ },
  { state: "sitting", label: "坐姿", pose: /坐(?:下|着|在)|落座|端坐/, transition: /坐下|落座|坐到/ },
  { state: "lying", label: "倒地/躺卧", pose: /倒在|倒地|躺(?:下|着|在)|仰卧|俯卧/, transition: /倒下|倒地|躺下|摔倒|坠地/ },
  { state: "walking", label: "行走", pose: /行走|走动|前行|迈步|奔跑|跑向|拖着[^。；，,]{0,20}(?:走|进入|前行)/, transition: /迈步|起步|走向|走近|靠近|前行|跑向|奔跑/ },
  { state: "standing", label: "站立", pose: /站(?:立|着|在)|立在|停步|站定/, transition: /停下|停步|站定|起身|站起|直起身/ },
] as const;

function postureState(evidence: string) {
  return postureRules.find((rule) => rule.pose.test(evidence));
}

/** Detect a visible posture jump shared by the same character dependency. */
export function comicPostureTransitionIssue(
  previousValue: unknown,
  nextValue: unknown,
) {
  if (!previousValue || typeof previousValue !== "object" || !nextValue || typeof nextValue !== "object")
    return "";
  const previous = previousValue as PostureShot,
    next = nextValue as PostureShot,
    previousCharacters = new Set(
      (Array.isArray(previous.characterIndexes) ? previous.characterIndexes : []).map(Number),
    ),
    sharesCharacter = (Array.isArray(next.characterIndexes) ? next.characterIndexes : [])
      .map(Number)
      .some((index) => previousCharacters.has(index));
  if (!sharesCharacter) return "";
  const previousFrames = Array.isArray(previous.frames) ? previous.frames : [],
    nextFrames = Array.isArray(next.frames) ? next.frames : [],
    previousFrame = previousFrames.at(-1),
    nextFrame = nextFrames[0];
  if (!previousFrame || typeof previousFrame !== "object" || !nextFrame || typeof nextFrame !== "object")
    return "";
  const previousRecord = previousFrame as Record<string, unknown>,
    nextRecord = nextFrame as Record<string, unknown>,
    previousEvidence = `${String(previousRecord.imagePrompt || "")} ${String(previousRecord.change || "")} ${String(previousRecord.lock || "")}`,
    nextPoseEvidence = `${String(nextRecord.imagePrompt || "")} ${String(nextRecord.inherit || "")}`,
    movementEvidence = `${String(next.action || "")} ${String(nextRecord.change || "")} ${String(next.videoPrompt || "")}`,
    previousState = postureState(previousEvidence),
    nextState = postureState(nextPoseEvidence);
  if (!previousState || !nextState || previousState.state === nextState.state)
    return "";
  if (nextState.transition.test(movementEvidence)) return "";
  return `镜头 ${Number(next.number) || "?"} 姿态从上一镜${previousState.label}直接跳到${nextState.label}，缺少可见过渡动作`;
}

export type ComicCharacterState = {
  characterIndex: number;
  posture: string;
  positionAnchor: string;
  facingTarget: string;
  heldPropIndexes: number[];
  transitionAction: string;
};

export function normalizeComicCharacterStates(
  value: unknown,
  visibleCharacterIndexes: number[],
  visiblePropIndexes: number[],
) {
  const visibleCharacters = new Set(visibleCharacterIndexes),
    visibleProps = new Set(visiblePropIndexes),
    byCharacter = new Map<number, ComicCharacterState>();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>,
      characterIndex = Number(item.characterIndex);
    if (!visibleCharacters.has(characterIndex) || byCharacter.has(characterIndex))
      continue;
    byCharacter.set(characterIndex, {
      characterIndex,
      posture: String(item.posture || "").trim().toLowerCase(),
      positionAnchor: String(item.positionAnchor || "").trim(),
      facingTarget: String(item.facingTarget || "").trim().toLowerCase(),
      heldPropIndexes: [...new Set(
        (Array.isArray(item.heldPropIndexes) ? item.heldPropIndexes : [])
          .map(Number)
          .filter((index) => visibleProps.has(index)),
      )],
      transitionAction: String(item.transitionAction || "").trim(),
    });
  }
  return [...byCharacter.values()];
}

export function comicCharacterStateTransitionIssues(
  previousValue: unknown,
  nextValue: unknown,
  shotNumber: number,
  frameNumber: number,
) {
  if (!previousValue || typeof previousValue !== "object" || !nextValue || typeof nextValue !== "object")
    return [];
  const previous = previousValue as Record<string, unknown>,
    next = nextValue as Record<string, unknown>,
    previousStates = new Map(
      (Array.isArray(previous.characterStates) ? previous.characterStates : [])
        .filter((item): item is ComicCharacterState => Boolean(item && typeof item === "object"))
        .map((item) => [Number(item.characterIndex), item]),
    ),
    nextStates = (Array.isArray(next.characterStates) ? next.characterStates : [])
      .filter((item): item is ComicCharacterState => Boolean(item && typeof item === "object")),
    issues: string[] = [];
  for (const state of nextStates) {
    const prior = previousStates.get(Number(state.characterIndex));
    if (!prior) continue;
    const changed: string[] = [];
    if (String(prior.posture) !== String(state.posture)) changed.push("姿态");
    if (String(prior.positionAnchor) !== String(state.positionAnchor)) changed.push("场景站位");
    if (String(prior.facingTarget) !== String(state.facingTarget)) changed.push("朝向");
    const previousHeld = [...(Array.isArray(prior.heldPropIndexes) ? prior.heldPropIndexes : [])].map(Number).sort((a,b)=>a-b),
      nextHeld = [...(Array.isArray(state.heldPropIndexes) ? state.heldPropIndexes : [])].map(Number).sort((a,b)=>a-b);
    if (JSON.stringify(previousHeld) !== JSON.stringify(nextHeld)) changed.push("持有道具");
    if (changed.length && !String(state.transitionAction || "").trim())
      issues.push(
        `镜头 ${shotNumber} 分镜 ${frameNumber} 角色 ID ${state.characterIndex} 的${changed.join("、")}发生变化但缺少 transitionAction`,
      );
  }
  return issues;
}

export function hasVisibleAnonymousCrowd(evidence: string) {
  const normalized = String(evidence)
    .replace(negativeCrowd, "")
    .replace(/无人物|无人画面|单人|只出现[^。；,，]{0,18}/g, "")
    .replace(negativeCrowd, "");
  return positiveCrowd.test(normalized);
}

/**
 * Resolve the production dependency from independent signals.  The model's
 * structured decision is intentional data and must not be discarded merely
 * because a later, compressed frame prompt uses a synonym our text detector
 * does not know yet. Text detection remains a second, independent safety net.
 */
export function resolveVisibleAnonymousCrowd(
  planned: unknown,
  expanded: unknown,
  crowdPrompt: unknown,
  evidence: string,
) {
  const structuredRequired = planned === true || expanded === true;
  const describedCrowd = hasVisibleAnonymousCrowd(String(crowdPrompt || ""));
  return structuredRequired || describedCrowd || hasVisibleAnonymousCrowd(evidence);
}

export type ComicSceneDependency = {
  sceneId: string;
  baseSceneId?: string;
  variantType?: "base" | "area" | "state" | "time";
  imagePrompt: string;
  propIndexes: number[];
  environmentAnchors: string[];
};

export function normalizeComicSceneHierarchy<T extends ComicSceneDependency>(scenes: T[]) {
  const byId = new Map(scenes.map((scene) => [scene.sceneId, scene]));
  for (const scene of scenes) {
    const requestedParent = String(scene.baseSceneId || "").trim();
    scene.baseSceneId = requestedParent && requestedParent !== scene.sceneId && byId.has(requestedParent)
      ? requestedParent
      : undefined;
    scene.variantType = scene.baseSceneId && ["area", "state", "time"].includes(String(scene.variantType))
      ? scene.variantType
      : "base";
  }
  // A malformed model response must never create a recursive canvas graph.
  for (const scene of scenes) {
    const visited = new Set([scene.sceneId]);
    let current: ComicSceneDependency | undefined = scene;
    while (current?.baseSceneId) {
      if (visited.has(current.baseSceneId)) {
        scene.baseSceneId = undefined;
        scene.variantType = "base";
        break;
      }
      visited.add(current.baseSceneId);
      current = byId.get(current.baseSceneId);
    }
  }
  return scenes;
}

export type ComicShotDependency = {
  sceneId: string;
  scenePrompt: string;
  frames: Array<{ propIndexes: number[] }>;
};

export function finalizeComicSceneDependencies(
  scenes: ComicSceneDependency[],
  shots: ComicShotDependency[],
  props: Array<{ name:string }>,
) {
  for (const scene of scenes) {
    const firstShot = shots.find((shot) => shot.sceneId === scene.sceneId);
    if (!firstShot) continue;
    const initiallyVisible = new Set(firstShot.frames.flatMap((frame) => frame.propIndexes));
    const futureProps = scene.propIndexes.filter((index) => !initiallyVisible.has(index));
    if (!futureProps.length) continue;
    scene.propIndexes = scene.propIndexes.filter((index) => initiallyVisible.has(index));
    const excludedTerms = futureProps.flatMap((index) => {
      const name = String(props[index - 1]?.name || "").trim();
      return comicAssetNameTerms(name);
    });
    scene.imagePrompt = stripComicFutureAssetClauses(scene.imagePrompt, excludedTerms);
    scene.environmentAnchors = scene.environmentAnchors.filter((anchor) => !excludedTerms.some((term) => anchor.includes(term)));
    for (const shot of shots) {
      if (shot.sceneId === scene.sceneId) shot.scenePrompt = scene.imagePrompt;
    }
  }
  return scenes;
}

export function comicAssetNameMentioned(evidence: string, name: string) {
  return comicAssetNameTerms(name).some((term) => evidence.includes(term));
}

export function normalizeComicAssetIndexes(value: unknown, assetCount: number) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map(Number)
      .filter(
        (index) =>
          Number.isInteger(index) && index >= 1 && index <= assetCount,
      ),
  )];
}

function comicAssetNameTerms(name: string) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return [];
  const parts = normalizedName.split(/[与和及、]/).map((term) => term.trim()).filter(Boolean);
  return [...new Set([normalizedName, ...parts, ...parts.flatMap((term) => [
    term.replace(/^.*?后的/, ""),
    term.replace(/^(?:远古|古老|巨大|黑色|白色|金色|银色|破碎|残破|封印中的|沉睡的)/, ""),
  ])].filter((term) => term.length >= 2))];
}

function stripComicFutureAssetClauses(value: string, terms: string[]) {
  const cleaned = String(value || "")
    .split(/([，；。])/)
    .reduce<string[]>((parts, segment, index, source) => {
      if (/^[，；。]$/.test(segment)) return parts;
      if (terms.some((term) => segment.includes(term))) return parts;
      const separator = source[index + 1];
      parts.push(`${segment.trim()}${/^[，；。]$/.test(separator || "") ? separator : ""}`);
      return parts;
    }, [])
    .join("")
    .replace(/[，；。]{2,}/g, "；")
    .replace(/^[，；。\s]+|[，；。\s]+$/g, "")
    .trim();
  return cleaned || "无人物初始场景基准图，保持固定空间结构、建筑方位与主光一致";
}
