export function createPromptAgentShell() {
  const panel = document.createElement("section");
  panel.className = "prompt-agent-panel agent-capsule";
  panel.innerHTML = `<aside class="agent-selection-hint" aria-live="polite"><i>◇</i><span>点击卡片选择素材</span><em></em><kbd>右击</kbd><small>退出</small></aside><section class="agent-context"><div data-agent-context-list></div></section><div class="agent-mode"><button type="button" data-agent-mode-trigger aria-label="选择灵感功能" aria-expanded="false"><span>✦</span><b>功能</b><i></i></button><div class="agent-mode-menu"><button type="button" data-agent-comic><b>漫剧</b><small>进入对话式漫剧创作</small></button><button type="button" data-agent-mode="voice"><b>音色</b><small>描述声音并创建语音配置</small></button><div class="agent-prompt-submenu"><button type="button" data-agent-prompt-menu aria-expanded="false"><b>提示词</b><small>选择创作策略</small><i></i></button><div><button type="button" data-agent-mode="create"><b>创作</b><small>选择素材并创建关联节点</small></button><button type="button" data-agent-mode="general"><b>通用</b><small>只生成通用格式 Prompt</small></button><button type="button" data-agent-mode="agnes"><b>Agnes</b><small>只生成 Agnes Video v2.0 Prompt</small></button></div></div></div></div><label class="agent-goal"><textarea rows="1" placeholder="告诉我你想创造什么…" aria-label="创作需求"></textarea></label><button class="agent-submit" type="button" aria-label="开始创作"><span>✦</span><b>开始创作</b></button><output class="agent-status" hidden></output><article hidden><div class="agent-result-meta"><span>执行结果</span><small></small></div><strong data-agent-summary></strong><p data-agent-prompt></p><footer><button type="button" data-agent-undo hidden>撤销</button><button type="button" data-agent-apply hidden>写入选中卡片</button><button type="button" data-agent-copy>复制</button><button type="button" data-agent-locate>定位</button></footer></article>`;
  panel.querySelector(".agent-mode")?.classList.replace("agent-mode", "inspiration-mode");
  panel.querySelector(".agent-mode-menu")?.classList.replace("agent-mode-menu", "inspiration-mode-menu");
  panel.querySelector(".agent-prompt-submenu")?.classList.replace("agent-prompt-submenu", "inspiration-strategy");
  const comicBusyProxy = document.createElement("button");
  comicBusyProxy.className = "agent-comic-entry";
  comicBusyProxy.hidden = true;
  panel.append(comicBusyProxy);
  document.body.append(panel);
  return { panel, comicBusyProxy };
}
