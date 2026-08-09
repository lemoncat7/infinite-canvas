const crowdTerm =
  "(?:匿名(?:背景)?(?:人物|人群|群众)|背景(?:人物|人群|群众)|路人群众|围观群众|群众|人群|路人|围观者|修士们?|弟子们?)";
const negativeCrowd = new RegExp(
  `(?:无|禁止|不得|不出现|没有|不包含)[^。；,，]{0,20}${crowdTerm}`,
  "g",
);
const positiveCrowd =
  /(?:匿名背景(?:人物|人群)|背景人群|围观群众|路人群|修士人群|众修士|弟子们)|(?:群众|人群|路人|围观者|修士们|弟子们)[^。；,，]{0,16}(?:聚集|围观|分散|站立|奔跑|后退|惊呼|交谈|涌入)/;

export function hasVisibleAnonymousCrowd(evidence: string) {
  const normalized = String(evidence)
    .replace(negativeCrowd, "")
    .replace(/无人物|无人画面|单人|只出现[^。；,，]{0,18}/g, "")
    .replace(negativeCrowd, "");
  return positiveCrowd.test(normalized);
}

export type ComicSceneDependency = {
  sceneId: string;
  imagePrompt: string;
  propIndexes: number[];
  environmentAnchors: string[];
};

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
