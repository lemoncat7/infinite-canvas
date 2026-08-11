import type { FlowNode } from "./node-types";
import { bindNodeConfigPanel } from "../ui/node-editor";

interface VoiceNodePanelsOptions {
  element: HTMLElement;
  voicePanel: HTMLElement;
  ttsPanel: HTMLElement;
  audioPanel: HTMLElement;
  liveNode: () => FlowNode | undefined;
  scheduleSave: () => void;
  draw: () => void;
  previewVoice: (node: FlowNode) => void | Promise<void>;
  generateTts: (node: FlowNode) => void | Promise<void>;
  selectNode: (id: number) => void;
}

export function bindVoiceNodePanels(options: VoiceNodePanelsOptions) {
  const {
    element,
    voicePanel,
    ttsPanel,
    audioPanel,
    liveNode,
    scheduleSave,
    draw,
    previewVoice,
    generateTts,
    selectNode,
  } = options;
  voicePanel.querySelector(":scope > header")?.remove();
  voicePanel.querySelector(".voice-profile-readout")?.remove();
  audioPanel.innerHTML = `<header class="video-node-heading"><div><b data-audio-title>音频结果</b><small data-audio-meta>等待生成</small></div></header><div class="audio-player-slot"><div class="audio-track-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><audio preload="metadata"></audio></div><p>双击播放或暂停</p><button type="button" data-audio-toggle hidden><span>▶</span></button><button type="button" data-audio-download hidden>下载音频</button>`;
  ttsPanel.classList.add("node-composer-panel");
  ttsPanel.innerHTML = `<header><span>TTS</span><small data-tts-source>需要连接语音配置</small></header><textarea data-tts-text rows="5" placeholder="填写这一镜的对白、旁白或系统播报…"></textarea><footer class="node-composer-footer"><div class="tts-voice-readout node-composer-option"><span>◉</span><b data-tts-voice-label>关联音色</b></div><details class="video-settings-picker tts-settings-picker"><summary><span>⚙</span><b>语音属性</b></summary><div class="video-settings-popover tts-settings-popover"><header><b>语音设置</b><small>调整这一段文本的表达方式</small></header><div class="video-setting-row"><b>情绪</b><div class="video-pill-grid"><button type="button" data-tts-emotion="中性">中性</button><button type="button" data-tts-emotion="冷静">冷静</button><button type="button" data-tts-emotion="温柔">温柔</button><button type="button" data-tts-emotion="紧张">紧张</button><button type="button" data-tts-emotion="激动">激动</button><button type="button" data-tts-emotion="沉重">沉重</button></div><select data-tts-field="emotion" hidden><option>中性</option><option>冷静</option><option>温柔</option><option>紧张</option><option>激动</option><option>沉重</option></select></div><div class="video-setting-row"><b>格式</b><div class="video-pill-grid"><button type="button" class="active" data-tts-format="mp3">MP3</button></div><select data-tts-field="format" hidden><option value="mp3">MP3</option></select></div></div></details><button class="node-composer-submit" type="button" data-tts-generate><span>▶</span><b>生成</b></button></footer>`;
  element
    .querySelectorAll<HTMLElement>(".node-composer-footer>details>summary")
    .forEach((summary) => summary.classList.add("node-composer-option"));
  const providerField = voicePanel.querySelector<HTMLSelectElement>(
    '[data-voice-field="provider"]',
  )!;
  providerField.value = "easyvoice-local";
  providerField.hidden = true;
  const providerLabel = providerField.closest("label")!;
  providerLabel.hidden = false;
  providerLabel.classList.add("voice-provider-field");
  providerLabel.insertAdjacentHTML("beforeend", "<b>EasyVoice</b>");
  voicePanel.querySelector<HTMLSelectElement>(
    '[data-voice-field="voiceId"]',
  )!.innerHTML =
    '<option value="zh-CN-XiaoxiaoNeural">晓晓 · 温暖女声</option><option value="zh-CN-YunjianNeural">云健 · 激昂男声</option><option value="zh-CN-YunxiaNeural">云夏 · 少年男声</option><option value="zh-CN-YunyangNeural">云扬 · 稳重男声</option>';
  const voiceFooter =
      voicePanel.querySelector<HTMLElement>(".voice-card-footer")!,
    voicePopover = voicePanel.querySelector<HTMLElement>(
      ".voice-settings-popover",
    )!,
    voiceTone = voicePopover.querySelector<HTMLElement>(":scope > label")!,
    voiceSelect = voiceTone.querySelector<HTMLSelectElement>(
      '[data-voice-field="voiceId"]',
    )!,
    voicePreview = voicePanel.querySelector<HTMLButtonElement>(
      "[data-voice-preview]",
    )!,
    voiceSliders = document.createElement("div"),
    voiceActions = document.createElement("div"),
    voiceModelPicker = document.createElement("details");
  voiceSliders.className = "voice-slider-row";
  voiceActions.className = "voice-action-row";
  voicePreview.classList.add("node-composer-submit");
  voiceModelPicker.className = "video-model-picker voice-model-picker";
  voiceModelPicker.innerHTML =
    '<summary class="node-composer-option"><span>◈</span><b>晓晓 · 温暖女声</b></summary><div class="video-model-popover voice-model-menu"></div>';
  voiceSelect.hidden = true;
  voiceModelPicker.append(voiceSelect);
  voicePopover
    .querySelectorAll<HTMLElement>(".video-setting-row")
    .forEach((row) => voiceSliders.append(row));
  voiceActions.append(voiceModelPicker, voicePreview);
  voiceFooter.replaceChildren(voiceSliders, voiceActions);
  for (const panel of [voicePanel, ttsPanel, audioPanel])
    bindNodeConfigPanel(panel);
  voicePanel
    .querySelectorAll<HTMLInputElement>(
      '[data-voice-field="speed"],[data-voice-field="pitch"],[data-voice-field="volume"]',
    )
    .forEach((input) => {
      input.type = "range";
      input.hidden = false;
    });
  voiceModelPicker.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-voice-option]",
    );
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    voiceSelect.value = button.dataset.voiceOption!;
    voiceSelect.dispatchEvent(new Event("input", { bubbles: true }));
    voiceModelPicker.open = false;
  });
  voicePanel
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[data-voice-field]",
    )
    .forEach((field) =>
      field.addEventListener("input", () => {
        const current = liveNode();
        if (!current) return;
        current.voiceSettings = {
          ...(current.voiceSettings || {}),
          language: current.voiceSettings?.language || "zh-CN",
          roleName: voicePanel.querySelector<HTMLInputElement>(
            '[data-voice-field="roleName"]',
          )!.value,
          providerId: voicePanel.querySelector<HTMLSelectElement>(
            '[data-voice-field="provider"]',
          )!.value,
          voiceId: voicePanel.querySelector<HTMLSelectElement>(
            '[data-voice-field="voiceId"]',
          )!.value,
          defaultSpeed:
            Number(
              voicePanel.querySelector<HTMLInputElement>(
                '[data-voice-field="speed"]',
              )!.value,
            ) || 1,
          pitch:
            Number(
              voicePanel.querySelector<HTMLInputElement>(
                '[data-voice-field="pitch"]',
              )!.value,
            ) || 0,
          volume: Number(
            voicePanel.querySelector<HTMLInputElement>(
              '[data-voice-field="volume"]',
            )!.value,
          ),
        };
        if (current.voiceSettings.roleName)
          current.title = `语音配置 · ${current.voiceSettings.roleName}`;
        scheduleSave();
        draw();
      }),
    );
  voicePanel
    .querySelectorAll<HTMLButtonElement>("[data-voice-step]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const field = button.dataset.voiceStep as "speed" | "pitch" | "volume",
          input = voicePanel.querySelector<HTMLInputElement>(
            `[data-voice-field="${field}"]`,
          )!,
          minimum = Number(input.min),
          maximum = Number(input.max),
          next = Math.max(
            minimum,
            Math.min(
              maximum,
              Number(input.value || 0) + Number(button.dataset.step || 0),
            ),
          );
        input.value = String(Number(next.toFixed(2)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
  voicePanel
    .querySelector<HTMLButtonElement>("[data-voice-preview]")!
    .addEventListener("click", () => {
      const current = liveNode();
      if (current) void previewVoice(current);
    });
  ttsPanel
    .querySelector<HTMLTextAreaElement>("[data-tts-text]")!
    .addEventListener("input", (event) => {
      const current = liveNode();
      if (!current) return;
      current.body = (event.target as HTMLTextAreaElement).value;
      scheduleSave();
      draw();
    });
  ttsPanel
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-tts-field]")
    .forEach((field) =>
      field.addEventListener("input", () => {
        const current = liveNode();
        if (!current) return;
        current.ttsSettings = {
          emotion: ttsPanel.querySelector<HTMLSelectElement>(
            '[data-tts-field="emotion"]',
          )!.value,
          format: ttsPanel.querySelector<HTMLSelectElement>(
            '[data-tts-field="format"]',
          )!.value as "wav" | "mp3" | "flac",
        };
        scheduleSave();
        draw();
      }),
    );
  ttsPanel
    .querySelectorAll<HTMLButtonElement>("[data-tts-emotion]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const select = ttsPanel.querySelector<HTMLSelectElement>(
          '[data-tts-field="emotion"]',
        )!;
        select.value = button.dataset.ttsEmotion!;
        select.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
  ttsPanel
    .querySelectorAll<HTMLButtonElement>("[data-tts-format]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const select = ttsPanel.querySelector<HTMLSelectElement>(
          '[data-tts-field="format"]',
        )!;
        select.value = button.dataset.ttsFormat!;
        select.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
  ttsPanel
    .querySelector<HTMLButtonElement>("[data-tts-generate]")!
    .addEventListener("click", () => {
      const current = liveNode();
      if (current) void generateTts(current);
    });
  audioPanel
    .querySelector<HTMLButtonElement>("[data-audio-download]")!
    .addEventListener("click", () => {
      const current = liveNode();
      if (!current?.mediaUrl) return;
      const anchor = document.createElement("a");
      anchor.href = current.mediaUrl;
      anchor.download = `${current.title}.${current.ttsSettings?.format || "mp3"}`;
      anchor.click();
    });
  const audioElement = audioPanel.querySelector<HTMLAudioElement>("audio")!,
    audioToggle = audioPanel.querySelector<HTMLButtonElement>(
      "[data-audio-toggle]",
    )!;
  audioToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = liveNode();
    if (!current?.mediaUrl) return;
    selectNode(current.id);
    if (audioElement.paused) void audioElement.play();
    else audioElement.pause();
    audioToggle.querySelector("span")!.textContent = audioElement.paused
      ? "▶"
      : "Ⅱ";
  });
  audioElement.addEventListener("play", () => {
    audioToggle.querySelector("span")!.textContent = "Ⅱ";
  });
  audioElement.addEventListener("pause", () => {
    audioToggle.querySelector("span")!.textContent = "▶";
  });
  audioElement.addEventListener("ended", () => {
    audioToggle.querySelector("span")!.textContent = "▶";
  });
  
}
