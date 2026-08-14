import type { FlowNode } from "./node-types";

interface CustomNodeModel {
  id: string;
  kind: "image" | "video";
  name: string;
  model: string;
}

interface NodeViewFactoryOptions {
  node: FlowNode;
  getNode: () => FlowNode | undefined;
  authUser: { credits?: number; reservedCredits?: number } | null;
  customApiModels: CustomNodeModel[];
  escapeHtml: (value: string) => string;
  copyPrompt: (value?: string) => void | Promise<void>;
}

export function createNodeView(options: NodeViewFactoryOptions) {
  const {
    node,
    getNode,
    authUser,
    customApiModels,
    escapeHtml,
    copyPrompt,
  } = options;
  const element = document.createElement("article");
  element.dataset.id = String(node.id);
  element.className = "flow-node";
  element.innerHTML = `<div class="node-floating-tools"><button data-action="info" title="信息">ⓘ</button><button data-action="edit" title="编辑">✎</button><button data-action="zoom-in" title="放大文字">＋</button><button data-action="zoom-out" title="缩小文字">−</button><button data-action="generate" title="生成">✦</button><button data-action="preview" title="预览">⌕</button><button data-action="download" title="下载图片">↓</button><button data-action="delete" title="删除">⌫</button></div><div class="node-info-popover"></div><div class="node-port input" data-side="left"></div><div class="node-port output" data-side="right"></div><span class="node-kind"></span><h3 class="node-label-heading" hidden></h3><div class="node-media"><canvas class="node-media-canvas" width="560" height="440"></canvas></div><div class="image-empty-state"><span>▧</span><b>空图节点</b><small>生成新图片，或复用已有素材</small><div class="image-source-actions"><button type="button" data-image-upload>↑ 上传</button><button type="button" data-image-library>▦ 资产库</button></div></div><div class="node-copy"></div><div class="node-progress"><i></i></div><section class="image-config-panel"><div class="image-composer-title"><span>IMAGE</span><small>描述你想创造的画面</small></div><textarea data-image-field="description" rows="4" aria-label="图片描述" placeholder="例如：清晨薄雾中的未来城市，电影感光影…"></textarea><footer><details class="image-model-picker"><summary><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"></path></svg><b data-image-model-label>gpt-image-2</b><i>⌄</i></summary><div class="image-model-menu"><small>选择图像模型</small><button type="button" data-image-model="gpt-image-2"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg><span><b>gpt-image-2</b><small>OpenAI 图像生成</small></span><i>✓</i></button></div><select data-image-field="model" aria-label="模型" hidden><option value="gpt-image-2">gpt-image-2</option></select></details><details><summary><span>⚙</span><b data-image-settings-label>自动质量 · 自动尺寸</b><i>⌃</i></summary><div class="image-settings-popover"><header><span>图像设置</span><small>调整输出规格</small></header><label><span><b>质量</b><small>细节与生成速度</small></span><select data-image-field="quality"><option value="auto">自动质量</option><option value="high">高质量</option><option value="medium">标准质量</option><option value="low">低质量</option></select></label><label><span><b>画面尺寸</b><small>输出宽高比例</small></span><select data-image-field="size"><option value="auto">自动尺寸</option><option value="1024x1024">1:1 · 1024 × 1024</option><option value="1536x1024">3:2 · 1536 × 1024</option><option value="1024x1536">2:3 · 1024 × 1536</option></select></label><label><span><b>背景</b><small>画面底色模式</small></span><select data-image-field="background"><option value="auto">自动背景</option><option value="transparent">透明背景</option><option value="opaque">不透明背景</option></select></label></div></details><button data-image-generate type="button" title="开始生成" aria-label="生成"><span>↑</span></button></footer></section>`;
  element.insertAdjacentHTML(
    "beforeend",
    `<section class="voice-config-panel"><header><i>◉</i><span><b>角色声音</b><small>固定角色跨镜头声音</small></span></header><div class="voice-card-profile"><label><span>角色名称</span><input data-voice-field="roleName" placeholder="例如：林夜"></label><div class="voice-profile-readout"><i>∿</i><span><b data-voice-summary>晓晓 · 温暖女声</b><small data-voice-params>1.0× · 0Hz · 100%</small></span></div></div><label hidden><span>语音服务</span><select data-voice-field="provider"><option value="easyvoice-local">EasyVoice 中文语音</option></select></label><footer class="voice-card-footer"><span class="voice-current"><small>当前音色</small><b data-voice-current>晓晓</b></span><details class="voice-settings-picker"><summary><span>⚙</span><b>配置</b><i>⌄</i></summary><div class="voice-settings-popover"><header><b>声音配置</b><small>固定该角色的声音表现</small></header><label><span>音色</span><select data-voice-field="voiceId"><option value="zh-CN-XiaoxiaoNeural">晓晓 · 温暖女声</option><option value="zh-CN-YunxiNeural">云希 · 阳光男声</option></select></label><div class="video-setting-row"><b>语速</b><div class="voice-stepper"><button type="button" data-voice-step="speed" data-step="-0.05">−</button><output data-voice-output="speed">1.0×</output><button type="button" data-voice-step="speed" data-step="0.05">＋</button><input data-voice-field="speed" type="number" min="0.5" max="2" step="0.05" hidden></div></div><div class="video-setting-row"><b>音调</b><div class="voice-stepper"><button type="button" data-voice-step="pitch" data-step="-2">−</button><output data-voice-output="pitch">0Hz</output><button type="button" data-voice-step="pitch" data-step="2">＋</button><input data-voice-field="pitch" type="number" min="-50" max="50" step="1" hidden></div></div><div class="video-setting-row"><b>音量</b><div class="voice-stepper"><button type="button" data-voice-step="volume" data-step="-0.05">−</button><output data-voice-output="volume">100%</output><button type="button" data-voice-step="volume" data-step="0.05">＋</button><input data-voice-field="volume" type="number" min="0" max="2" step="0.05" hidden></div></div></div></details><button type="button" data-voice-preview><span>▶</span><b>试听</b></button></footer></section><section class="tts-config-panel"><header><span><b>TTS 文本生成</b><small data-tts-source>需要连接语音配置</small></span></header><textarea data-tts-text rows="4" placeholder="填写这一镜的对白、旁白或系统播报"></textarea><div class="tts-three-fields"><label><span>情绪</span><select data-tts-field="emotion"><option>中性</option><option>冷静</option><option>温柔</option><option>紧张</option><option>激动</option><option>沉重</option></select></label><label><span>格式</span><select data-tts-field="format"><option value="mp3">MP3</option></select></label></div><button type="button" data-tts-generate><span>▶</span><b>生成语音</b></button></section><section class="audio-result-panel"><div class="audio-result-heading"><span>AUDIO</span><strong data-audio-title>音频结果</strong></div><div class="audio-result-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><audio preload="metadata"></audio><button class="audio-result-toggle" type="button" data-audio-toggle aria-label="播放音频"><span>▶</span></button><small class="audio-result-meta" data-audio-meta>等待生成</small><small class="audio-result-hint">双击播放</small><button type="button" data-audio-download hidden>下载音频</button></section>`,
  );
  const voicePanel = element.querySelector<HTMLElement>(".voice-config-panel")!,
    ttsPanel = element.querySelector<HTMLElement>(".tts-config-panel")!,
    audioPanel = element.querySelector<HTMLElement>(".audio-result-panel")!;
  const initialMediaCanvas =
    element.querySelector<HTMLCanvasElement>(".node-media-canvas")!;
  initialMediaCanvas.width = 2;
  initialMediaCanvas.height = 2;
  const resizeHandle = document.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "node-resize-handle";
  resizeHandle.title = "拖动调整标签大小";
  resizeHandle.setAttribute("aria-label", "调整标签大小");
  element.append(resizeHandle);
  const mediaVideo = document.createElement("video");
  mediaVideo.className = "node-media-video";
  mediaVideo.muted = true;
  mediaVideo.playsInline = true;
  mediaVideo.preload = "metadata";
  mediaVideo.draggable = false;
  mediaVideo.hidden = true;
  element.querySelector(".node-media")!.append(mediaVideo);
  const zoomHint = document.createElement("span");
  zoomHint.className = "image-zoom-hint";
  zoomHint.textContent = node.kind === "video" ? "双击播放" : "双击放大";
  element.querySelector(".node-media")!.append(zoomHint);
  const videoPanel = document.createElement("section");
  videoPanel.className = "video-config-panel node-composer-panel";
  videoPanel.innerHTML = `<header><span>VIDEO</span><small>描述画面内容、动作与镜头变化</small></header><textarea data-video-description rows="5" placeholder="例如：人物缓慢转身，镜头向前推进，柔和电影光影…"></textarea><footer class="node-composer-footer"><details class="video-model-picker"><summary><span>◈</span><b>视频模型</b></summary><div class="video-model-popover"><small>模型名称</small><input data-video-model value="Kling 2.1" aria-label="视频模型"></div></details><details class="video-settings-picker"><summary><span>⚙</span><b>视频属性</b></summary><div class="video-settings-popover"><header><b>视频设置</b><small>调整输出规格</small></header><div class="video-setting-row video-timing-row"><b>时长</b><div class="video-timing-controls"><div class="video-seconds-stepper"><button data-seconds-step="-1" type="button" aria-label="减少一秒">−</button><output data-video-seconds>5 秒</output><button data-seconds-step="1" type="button" aria-label="增加一秒">＋</button></div><div class="video-reference-mode" aria-label="图片用途"><button data-video-setting="referenceMode" data-value="keyframes" type="button">关键帧</button><button data-video-setting="referenceMode" data-value="references" type="button">参考图</button></div></div></div><div class="video-setting-row"><b>分辨率</b><div class="video-pill-grid"><button data-video-setting="resolution" data-value="480p" type="button">480p</button><button data-video-setting="resolution" data-value="720p" type="button">720p</button><button data-video-setting="resolution" data-value="1080p" type="button">1080p</button></div></div><div class="video-setting-row"><b>比例</b><div class="video-ratio-grid"><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="1:1" type="button"><i style="--ratio:1"></i><span>方形</span><small>1:1</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="4:3" type="button"><i style="--ratio:1.333"></i><span>横向</span><small>4:3</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="3:4" type="button"><i style="--ratio:.75"></i><span>竖向</span><small>3:4</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="16:9" type="button"><i style="--ratio:1.778"></i><span>宽屏</span><small>16:9</small></button><button class="video-ratio-card" data-video-setting="aspectRatio" data-value="9:16" type="button"><i style="--ratio:.5625"></i><span>竖屏</span><small>9:16</small></button></div></div><label class="video-seed-field"><span>复现种子</span><input data-video-seed type="number" min="0" step="1" placeholder="留空则随机"><small>相同素材与参数可用于结果对照</small></label></div></details><button class="node-composer-submit" data-video-generate type="button"><span>▶</span><b>生成</b></button></footer>`;
  element.append(videoPanel);
  const videoResultPrompt = document.createElement("section");
  videoResultPrompt.className = "video-result-prompt";
  videoResultPrompt.innerHTML =
    '<header><span>上次生成提示词</span><small>点击复制</small></header><p role="button" tabindex="0" title="复制上次生成提示词"></p>';
  element.append(videoResultPrompt);
  videoResultPrompt.addEventListener("pointerdown", (event) =>
    event.stopPropagation(),
  );
  videoResultPrompt.addEventListener("mousedown", (event) =>
    event.stopPropagation(),
  );
  videoResultPrompt.addEventListener("click", (event) =>
    event.stopPropagation(),
  );
  const videoPromptText = videoResultPrompt.querySelector<HTMLElement>("p")!;
  const copyVideoPrompt = () => {
    const current = getNode();
    void copyPrompt(
      current?.generationPrompt || videoPromptText.textContent || undefined,
    );
  };
  videoPromptText.addEventListener("click", copyVideoPrompt);
  videoPromptText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copyVideoPrompt();
    }
  });
  const videoModelPopover = videoPanel.querySelector<HTMLElement>(
      ".video-model-popover",
    )!,
    grokEnabled =
      Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0) >=
      2;
  videoModelPopover.innerHTML = `<small>选择视频模型</small><button type="button" data-video-model-option="agnes-video-v2.0"><span><b>Agnes Video 2.0</b><small>Agnes 专用视频接口</small></span><em class="model-price free">免费</em><i>✓</i></button><button type="button" class="${grokEnabled ? "" : "model-unavailable"}" data-video-model-option="grok-imagine-video-1.5-preview" ${grokEnabled ? "" : "disabled"}><span><b>Grok Imagine Video 1.5 Preview</b><small>${grokEnabled ? "付费视频模型" : "创作点数不足"}</small></span><em class="model-price ${grokEnabled ? "paid" : "locked"}">×2</em><i>${grokEnabled ? "✓" : "⌁"}</i></button><input type="hidden" data-video-model value="agnes-video-v2.0">`;
  for (const item of customApiModels.filter((item) => item.kind === "video"))
    videoModelPopover
      .querySelector("input")!
      .insertAdjacentHTML(
        "beforebegin",
        `<button type="button" data-video-model-option="custom:${item.id}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><em class="model-price paid">自定义</em><i>✓</i></button>`,
      );
  const videoCount = document.createElement("span");
  videoCount.className = "video-generation-count";
  element.append(videoCount);
  const videoResultModel = document.createElement("span");
  videoResultModel.className = "video-result-model";
  element.append(videoResultModel);
  const clearImageTool = document.createElement("button");
  clearImageTool.type = "button";
  clearImageTool.dataset.action = "clear-image";
  clearImageTool.title = "清除卡片图片";
  clearImageTool.textContent = "⌫";
  const imageUploadTool = document.createElement("button");
  imageUploadTool.type = "button";
  imageUploadTool.dataset.action = "image-upload";
  imageUploadTool.title = "上传";
  imageUploadTool.textContent = "↑";
  const imageLibraryTool = document.createElement("button");
  imageLibraryTool.type = "button";
  imageLibraryTool.dataset.action = "image-library";
  imageLibraryTool.title = "资产库";
  imageLibraryTool.textContent = "▦";
  const floatingTools = element.querySelector(".node-floating-tools")!;
  const generateTool = element.querySelector('[data-action="generate"]')!;
  floatingTools.insertBefore(imageUploadTool, generateTool);
  floatingTools.insertBefore(imageLibraryTool, generateTool);
  element
    .querySelector(".node-floating-tools")!
    .insertBefore(
      clearImageTool,
      element.querySelector('[data-action="delete"]'),
    );
  element
    .querySelector(".image-config-panel")!
    .classList.add("image-composer-v2", "node-composer-panel");
  element
    .querySelector(".image-config-panel footer")!
    .classList.add("node-composer-footer");
  element
    .querySelector("[data-image-generate]")!
    .classList.add("node-composer-submit");
  const imageModelMenu =
      element.querySelector<HTMLElement>(".image-model-menu")!,
    imageModelSelect = element.querySelector<HTMLSelectElement>(
      '[data-image-field="model"]',
    )!;
  const grokImageEnabled =
    Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0) >=
    1;
  imageModelMenu.insertAdjacentHTML(
    "beforeend",
    '<button type="button" data-image-model="agnes-image-2.1-flash"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"></path></svg><span><b>Agnes Image 2.1 Flash</b><small>文生图 · 图生图 · 多图合成</small></span><em class="model-price free">免费</em><i>✓</i></button>',
  );
  imageModelSelect.insertAdjacentHTML(
    "beforeend",
    '<option value="agnes-image-2.1-flash">Agnes Image 2.1 Flash</option>',
  );
  imageModelMenu.insertAdjacentHTML(
    "beforeend",
    `<button type="button" class="${grokImageEnabled ? "" : "model-unavailable"}" data-image-model="grok-imagine-image" ${grokImageEnabled ? "" : "disabled"}><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"></path></svg><span><b>Grok Imagine Image</b><small>${grokImageEnabled ? "Grok 图像生成" : "创作点数不足"}</small></span><em class="model-price ${grokImageEnabled ? "paid" : "locked"}">×1</em><i>${grokImageEnabled ? "✓" : "⌁"}</i></button>`,
  );
  imageModelSelect.insertAdjacentHTML(
    "beforeend",
    '<option value="grok-imagine-image">Grok Imagine Image</option>',
  );
  imageModelMenu.insertAdjacentHTML(
    "beforeend",
    '<button type="button" class="model-unavailable" data-image-model="gemini-3.1-flash-image" disabled><svg viewBox="0 0 24 24"><path d="M12 2c1.4 5.2 4.8 8.6 10 10-5.2 1.4-8.6 4.8-10 10-1.4-5.2-4.8-8.6-10-10 5.2-1.4 8.6-4.8 10-10Z"></path></svg><span><b>Gemini 3.1 Flash Image</b><small>CPA 图片接口适配中</small></span><em class="model-price locked">实验性</em><i>⌁</i></button>',
  );
  imageModelSelect.insertAdjacentHTML(
    "beforeend",
    '<option value="gemini-3.1-flash-image" disabled>Gemini 3.1 Flash Image · 实验性</option>',
  );
  for (const item of customApiModels.filter((item) => item.kind === "image")) {
    imageModelMenu.insertAdjacentHTML(
      "beforeend",
      `<button type="button" data-image-model="custom:${item.id}"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 12h8"></path></svg><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.model)} · 自定义 API</small></span><i>✓</i></button>`,
    );
    imageModelSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="custom:${item.id}">${escapeHtml(item.name)}</option>`,
    );
  }
  const originalPrompt = document.createElement("div");
  originalPrompt.className = "image-original-prompt";
  originalPrompt.innerHTML =
    '<header><span>原提示词 <small>不含动态约束 · 点击复制</small></span><button type="button" data-copy-current-prompt>复制当前描述</button></header><p role="button" tabindex="0" title="复制原提示词"></p>';
  element.querySelector(".image-config-panel textarea")!.before(originalPrompt);
  const imageReferences = document.createElement("section");
  imageReferences.className = "image-reference-manager";
  imageReferences.hidden = true;
  imageReferences.innerHTML =
    '<header><span><b>参考素材</b><small>编号即实际发送顺序</small></span><em>点击两张素材可交换</em></header><div data-image-reference-list></div>';
  originalPrompt.after(imageReferences);
  const imageMentionMenu = document.createElement("div");
  imageMentionMenu.className = "image-mention-menu";
  imageMentionMenu.hidden = true;
  imageMentionMenu.innerHTML =
    '<header><b>引用连接素材</b><small>选择后插入当前图号</small></header><div data-image-mention-list></div>';
  element.querySelector(".image-config-panel textarea")!.after(imageMentionMenu);
  const imagePromptText = originalPrompt.querySelector<HTMLElement>("p")!;
  imagePromptText.addEventListener(
    "click",
    () =>
      void copyPrompt(
        imagePromptText.textContent === "导入图片，无生成提示词"
          ? undefined
          : imagePromptText.textContent || undefined,
      ),
  );
  imagePromptText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void copyPrompt(
        imagePromptText.textContent === "导入图片，无生成提示词"
          ? undefined
          : imagePromptText.textContent || undefined,
      );
    }
  });
  originalPrompt
    .querySelector<HTMLButtonElement>("[data-copy-current-prompt]")!
    .addEventListener("click", (event) => {
      event.stopPropagation();
      const description = element.querySelector<HTMLTextAreaElement>(
        '[data-image-field="description"]',
      )!;
      void copyPrompt(description.value);
    });
  element
    .querySelectorAll(
      ".image-model-picker > summary > i,.image-config-panel footer > details:not(.image-model-picker) > summary > i",
    )
    .forEach((icon) => icon.remove());
  element.querySelector<HTMLElement>(".image-settings-popover")!.innerHTML =
    `<header><span>图像设置</span><small>调整输出质量与画面比例</small></header><section class="image-setting-section"><b>质量</b><div class="image-quality-options"><button type="button" data-image-setting="quality" data-value="auto">自动</button><button type="button" data-image-setting="quality" data-value="high">高</button><button type="button" data-image-setting="quality" data-value="medium">中</button><button type="button" data-image-setting="quality" data-value="low">低</button></div><select data-image-field="quality" hidden><option value="auto">自动</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></section><section class="image-setting-section"><b>尺寸 <small>可直接输入自定义宽高</small></b><div class="image-dimension-inputs"><label><span>W</span><input type="number" min="1" max="3840" placeholder="自动" data-image-width></label><i>×</i><label><span>H</span><input type="number" min="1" max="3840" placeholder="自动" data-image-height></label></div></section><section class="image-setting-section"><b>长宽比</b><div class="image-aspect-options"><button type="button" data-image-setting="size" data-value="auto"><i class="aspect-auto">A</i><span>自动</span></button><button type="button" data-image-setting="size" data-value="1024x1024"><i class="aspect-square"></i><span>1:1</span></button><button type="button" data-image-setting="size" data-value="1344x1008"><i class="aspect-4-3"></i><span>4:3</span></button><button type="button" data-image-setting="size" data-value="1008x1344"><i class="aspect-3-4"></i><span>3:4</span></button><button type="button" data-image-setting="size" data-value="1536x1024"><i class="aspect-landscape"></i><span>3:2</span></button><button type="button" data-image-setting="size" data-value="1024x1536"><i class="aspect-portrait"></i><span>2:3</span></button><button type="button" data-image-setting="size" data-value="1536x864"><i class="aspect-16-9"></i><span>16:9</span></button><button type="button" data-image-setting="size" data-value="864x1536"><i class="aspect-9-16"></i><span>9:16</span></button><button type="button" data-custom-size><i class="aspect-auto">✎</i><span>自定义</span></button></div><select data-image-field="size" hidden><option value="auto">自动</option><option value="1024x1024">1:1</option><option value="1344x1008">4:3</option><option value="1008x1344">3:4</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option><option value="1536x864">16:9</option><option value="864x1536">9:16</option></select><p class="image-size-notice">尺寸设置可能因接口兼容性不生效，可在提示词中同时指定画面比例。</p></section><section class="image-setting-section image-background-setting"><span><b>透明背景</b><small>仅部分模型支持</small></span><button type="button" data-image-setting="background" data-value="transparent" aria-label="透明背景"><i></i></button><select data-image-field="background" hidden><option value="auto">自动</option><option value="transparent">透明</option><option value="opaque">不透明</option></select></section>`;
  const settingsPopover = element.querySelector<HTMLElement>(
    ".image-settings-popover",
  )!;
  settingsPopover
    .querySelector("[data-image-width]")
    ?.closest(".image-setting-section")
    ?.remove();
  settingsPopover.querySelector("[data-custom-size]")?.remove();
  settingsPopover.querySelector("header small")!.textContent =
    "常用画面比例与输出规格";
  return {
    element,
    resizeHandle,
    voicePanel,
    ttsPanel,
    audioPanel,
    videoPanel,
  };
}
