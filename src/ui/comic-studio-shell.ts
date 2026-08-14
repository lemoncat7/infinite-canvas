export type ComicStudioShell = {
  studio: HTMLElement;
  conversation: HTMLElement;
  sourcePlan: HTMLElement;
  sidePlan: HTMLElement;
  headerNav: HTMLElement;
  briefPanel: HTMLElement;
  thinkingStatus: HTMLOutputElement;
  composer: HTMLElement;
  messageField: HTMLTextAreaElement;
};

export function createComicStudioShell(): ComicStudioShell {
  const studio = document.createElement("section");
  studio.className = "comic-studio comic-chat-studio";
  studio.innerHTML = `<header><div><small>VIORA STORY</small><h2>和灵感一起写漫剧</h2></div><nav><div class="comic-label-control"><button type="button" data-comic-label-picker aria-label="关联标签"><span>◇</span><b>关联</b></button><div class="comic-label-menu" data-comic-label-menu></div></div><button type="button" data-comic-new aria-label="新会话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>新会话</span></button><button type="button" data-comic-close aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25"/></svg></button></nav></header><aside class="comic-linked-label" data-comic-linked-label hidden></aside><div class="comic-conversation" data-comic-conversation><div class="comic-message assistant comic-welcome"><i>✦</i><div><b>先聊聊你想做的故事</b><p>我会边聊边整理创作方案，不会因为一句话就直接生成。等方向明确后，由你确认生成完整剧本。</p></div></div><aside class="comic-brief" data-comic-brief hidden><header><span><small>当前方案</small><b data-comic-brief-title>正在整理</b></span><em data-comic-brief-state>讨论中</em></header><div data-comic-brief-content></div><button type="button" data-comic-confirm hidden><span>生成完整剧本</span><small>确认后开始正式构思</small></button></aside><section class="comic-plan" hidden><div class="comic-plan-head"><div><small data-comic-meta></small><h3 data-comic-title></h3><p data-comic-logline></p></div></div><div class="comic-plan-scroll"><article><h4>人物与世界</h4><div data-comic-characters></div></article><article><h4>剧情大纲</h4><ol data-comic-outline></ol></article><article><h4>制作分镜</h4><div data-comic-shots></div></article></div><div class="comic-plan-actions"><button type="button" data-comic-label><span>保存为标签</span></button><button type="button" data-comic-label-copy hidden><span>另存为标签</span></button><button type="button" data-comic-canvas><span>铺到画布</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div></section></div><footer class="comic-composer"><textarea data-comic-message rows="1" placeholder="继续补充人物、剧情、风格或你不想要的内容…"></textarea><button type="button" data-comic-send aria-label="发送"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></footer><output data-comic-status></output>`;
  document.body.append(studio);

  const conversation = studio.querySelector<HTMLElement>(
    "[data-comic-conversation]",
  )!;
  const sourcePlan = studio.querySelector<HTMLElement>(".comic-plan")!;
  sourcePlan.classList.add("comic-plan-source");
  const sidePlan = sourcePlan.cloneNode(true) as HTMLElement;
  sidePlan.classList.remove("comic-plan-source");
  sidePlan.classList.add("comic-plan-side");
  document.body.append(sidePlan);

  const headerNav = studio.querySelector<HTMLElement>(":scope > header nav")!;
  headerNav
    .querySelector<HTMLElement>(".comic-label-control")!
    .insertAdjacentHTML(
      "beforebegin",
      '<button type="button" data-comic-desktop-side="brief" aria-label="显示或隐藏当前方案"><span>当前方案</span></button><button type="button" data-comic-desktop-side="plan" aria-label="显示或隐藏完整方案"><span>完整方案</span></button><button type="button" data-comic-scheme aria-label="查看创作方案"><span>方案</span></button>',
    );

  const thinkingStatus = studio.querySelector<HTMLOutputElement>(
    "[data-comic-status]",
  )!;
  const composer = studio.querySelector<HTMLElement>(".comic-composer")!;
  const messageField = composer.querySelector<HTMLTextAreaElement>(
    "[data-comic-message]",
  )!;
  thinkingStatus.setAttribute("aria-live", "polite");
  composer.insertBefore(thinkingStatus, messageField);

  const briefPanel = studio.querySelector<HTMLElement>("[data-comic-brief]")!;
  briefPanel.classList.add("comic-brief-side", "expanded");
  document.body.append(briefPanel);

  return {
    studio,
    conversation,
    sourcePlan,
    sidePlan,
    headerNav,
    briefPanel,
    thinkingStatus,
    composer,
    messageField,
  };
}
