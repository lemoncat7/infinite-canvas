import { hasVisibleAnonymousCrowd } from "../dist/comic-validation.js";

const cases = [
  [false, "古城空巷全景，无人物，禁止群众和路人。"],
  [false, "林渊单人站在石碑前，无路人群众。"],
  [false, "无人知道古老封印已经松动。"],
  [false, "白棠一人检查水渠，无群众无人物剪影。"],
  [false, "只出现林夜与萧烈，禁止背景人群。"],
  [false, "场景不包含围观者，远处只有残碑。"],
  [true, "匿名背景人群分散站立在练武场四周。"],
  [true, "数名路人围观残碑，随后向后退开。"],
  [true, "修士们聚集在山门外低声交谈。"],
  [true, "弟子们分散站立，看到剑光后惊呼。"],
];

const failures = cases.filter(([expected, evidence]) => hasVisibleAnonymousCrowd(evidence) !== expected);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`comic crowd validation: ${cases.length}/${cases.length} passed`);

