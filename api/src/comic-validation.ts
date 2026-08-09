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

