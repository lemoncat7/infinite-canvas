import type {
  FlowLink,
  FlowNode,
  TtsProviderOption,
  TtsVoiceOption,
} from "./node-types";

interface VoiceTtsAudioSyncOptions {
  element: HTMLElement;
  node: FlowNode;
  nodes: FlowNode[];
  links: FlowLink[];
  providers: TtsProviderOption[];
  voicesByProvider: Map<string, TtsVoiceOption[]>;
  ensureProviders: () => void | Promise<void>;
  ensureVoices: (providerId: string) => void | Promise<void>;
  escapeHtml: (value: string) => string;
  renderSubmit: (button: HTMLButtonElement, locked: boolean, disabled?: boolean) => void;
  locked: boolean;
}

export function syncVoiceTtsAudioPanels(options: VoiceTtsAudioSyncOptions) {
  const {
    element,
    node,
    nodes,
    links,
    providers: ttsProviders,
    voicesByProvider: ttsVoicesByProvider,
    ensureProviders,
    ensureVoices,
    escapeHtml,
    renderSubmit,
    locked,
  } = options;
  const voicePanel = element.querySelector<HTMLElement>(
      ".voice-config-panel",
    )!,
    ttsPanel = element.querySelector<HTMLElement>(".tts-config-panel")!,
    audioPanel = element.querySelector<HTMLElement>(".audio-result-panel")!;
  voicePanel.hidden = true;
  ttsPanel.hidden = node.kind !== "tts";
  audioPanel.hidden = node.kind !== "audio";
  if (node.kind === "voice") {
    void ensureProviders();
    const providerId = node.voiceSettings?.providerId || "easyvoice-local";
    void ensureVoices(providerId);
    const roleName = voicePanel.querySelector<HTMLInputElement>(
        '[data-voice-field="roleName"]',
      )!,
      provider = voicePanel.querySelector<HTMLSelectElement>(
        '[data-voice-field="provider"]',
      )!,
      voice = voicePanel.querySelector<HTMLSelectElement>(
        '[data-voice-field="voiceId"]',
      )!,
      speed = voicePanel.querySelector<HTMLInputElement>(
        '[data-voice-field="speed"]',
      )!,
      pitch = voicePanel.querySelector<HTMLInputElement>(
        '[data-voice-field="pitch"]',
      )!,
      volume = voicePanel.querySelector<HTMLInputElement>(
        '[data-voice-field="volume"]',
      )!;
    const providerOptions = ttsProviders.length
        ? ttsProviders
        : [
            {
              provider: "easyvoice-local",
              name: "EasyVoice 中文语音",
              available: true,
              local: true,
              streaming: true,
              formats: ["mp3"],
              emotion: false,
              voiceCloning: false,
            },
          ],
      providerSignature = providerOptions
        .map((item) => `${item.provider}:${item.available}`)
        .join("|");
    if (provider.dataset.providerSignature !== providerSignature) {
      provider.dataset.providerSignature = providerSignature;
      provider.innerHTML =
        '<option value="easyvoice-local">EasyVoice 中文语音</option>';
    }
    const voices = ttsVoicesByProvider.get(providerId) || [],
      voiceSignature = `${providerId}:${voices.map((item) => item.id).join("|")}`;
    if (voices.length && voice.dataset.voiceSignature !== voiceSignature) {
      voice.dataset.voiceSignature = voiceSignature;
      voice.innerHTML = voices
        .filter((item) => !item.language || item.language === "zh-CN")
        .map(
          (item) =>
            `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`,
        )
        .join("");
    }
    if (document.activeElement !== roleName)
      roleName.value = node.voiceSettings?.roleName || "";
    if (document.activeElement !== provider)
      provider.value = node.voiceSettings?.providerId || "easyvoice-local";
    if (document.activeElement !== voice)
      voice.value = node.voiceSettings?.voiceId || "zh-CN-XiaoxiaoNeural";
    if (document.activeElement !== speed)
      speed.value = String(node.voiceSettings?.defaultSpeed ?? 1);
    if (document.activeElement !== pitch)
      pitch.value = String(node.voiceSettings?.pitch ?? 0);
    if (document.activeElement !== volume)
      volume.value = String(node.voiceSettings?.volume ?? 1);
    const selectedVoice = voices.find(
        (item) =>
          item.id === (node.voiceSettings?.voiceId || "zh-CN-XiaoxiaoNeural"),
      ),
      voiceName =
        selectedVoice?.name ||
        voice.selectedOptions[0]?.text ||
        "晓晓 · 温暖女声",
      speedValue = node.voiceSettings?.defaultSpeed ?? 1,
      pitchValue = node.voiceSettings?.pitch ?? 0,
      volumeValue = node.voiceSettings?.volume ?? 1,
      voicePicker = voicePanel.querySelector<HTMLElement>(
        ".voice-model-picker",
      ),
      voiceMenu = voicePanel.querySelector<HTMLElement>(".voice-model-menu");
    if (voicePicker)
      voicePicker.querySelector<HTMLElement>("summary b")!.textContent =
        voiceName;
    if (voiceMenu) {
      const availableVoices = voices.length
        ? voices
        : Array.from(voice.options).map((option) => ({
            id: option.value,
            name: option.textContent || option.value,
            language: "zh-CN",
          }));
      voiceMenu.innerHTML =
        '<small class="voice-menu-heading"><span>选择角色音色</span><em>可滚动</em></small>' +
        availableVoices
          .map(
            (item) =>
              `<button type="button" data-voice-option="${escapeHtml(item.id)}" class="${item.id === voice.value ? "active" : ""}"><span><b>${escapeHtml(item.name.split(" · ")[0])}</b><small>${escapeHtml(item.name.split(" · ").slice(1).join(" · ") || "中文音色")}</small></span><em class="model-price voice">中文</em><i>✓</i></button>`,
          )
          .join("");
    }
    voicePanel.querySelector<HTMLOutputElement>(
      '[data-voice-output="speed"]',
    )!.value = `${speedValue.toFixed(2).replace(/0$/, "")}×`;
    voicePanel.querySelector<HTMLOutputElement>(
      '[data-voice-output="pitch"]',
    )!.value = `${pitchValue > 0 ? "+" : ""}${pitchValue}Hz`;
    voicePanel.querySelector<HTMLOutputElement>(
      '[data-voice-output="volume"]',
    )!.value = `${Math.round(volumeValue * 100)}%`;
    for (const input of [speed, pitch, volume]) {
      const min = Number(input.min),
        max = Number(input.max),
        value = Number(input.value);
      input.style.setProperty(
        "--voice-range-progress",
        `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`,
      );
    }
    const emptyState =
        element.querySelector<HTMLElement>(".image-empty-state")!,
      roleLabel = node.voiceSettings?.roleName?.trim() || "未设置角色",
      content = `<header class="video-node-heading"><div><b>${escapeHtml(roleLabel)}</b><small>固定角色跨镜头声音</small></div></header><div class="voice-node-lines"><b>${escapeHtml(voiceName)}</b><small>${speedValue.toFixed(2).replace(/0$/, "")}× 语速 · ${pitchValue > 0 ? "+" : ""}${pitchValue}Hz 音调 · ${Math.round(volumeValue * 100)}% 音量</small></div><p>角色声音配置将在关联的 TTS 节点中复用</p>`;
    const renderKey = `voice-card:${content}`;
    if (emptyState.dataset.renderKey !== renderKey) {
      emptyState.dataset.renderKey = renderKey;
      emptyState.innerHTML = content;
    }
  }
  if (node.kind === "tts") {
    const voiceSource = links
        .filter((link) => link.to === node.id)
        .map((link) => nodes.find((item) => item.id === link.from))
        .find((item) => item?.kind === "voice"),
      sourceLabel = ttsPanel.querySelector<HTMLElement>("[data-tts-source]")!,
      voiceReadout = ttsPanel.querySelector<HTMLElement>(
        "[data-tts-voice-label]",
      )!,
      text = ttsPanel.querySelector<HTMLTextAreaElement>("[data-tts-text]")!,
      emotion = ttsPanel.querySelector<HTMLSelectElement>(
        '[data-tts-field="emotion"]',
      )!,
      format = ttsPanel.querySelector<HTMLSelectElement>(
        '[data-tts-field="format"]',
      )!,
      button = ttsPanel.querySelector<HTMLButtonElement>(
        "[data-tts-generate]",
      )!;
    const sourceVoices =
        ttsVoicesByProvider.get(
          voiceSource?.voiceSettings?.providerId || "easyvoice-local",
        ) || [],
      sourceVoiceName =
        sourceVoices.find(
          (item) => item.id === voiceSource?.voiceSettings?.voiceId,
        )?.name ||
        voiceSource?.voiceSettings?.voiceId ||
        "默认音色";
    sourceLabel.textContent = voiceSource
      ? "根据关联角色声音生成中文语音"
      : "连接语音配置后即可生成";
    voiceReadout.textContent = voiceSource
      ? `${voiceSource.voiceSettings?.roleName || "角色"} · ${sourceVoiceName}`
      : "关联音色";
    sourceLabel.classList.toggle("ready", Boolean(voiceSource));
    if (document.activeElement !== text) text.value = node.body;
    if (document.activeElement !== emotion)
      emotion.value = node.ttsSettings?.emotion || "中性";
    if (document.activeElement !== format)
      format.value = node.ttsSettings?.format || "mp3";
    ttsPanel
      .querySelectorAll<HTMLButtonElement>("[data-tts-emotion]")
      .forEach((item) =>
        item.classList.toggle(
          "active",
          item.dataset.ttsEmotion === emotion.value,
        ),
      );
    ttsPanel
      .querySelectorAll<HTMLButtonElement>("[data-tts-format]")
      .forEach((item) =>
        item.classList.toggle(
          "active",
          item.dataset.ttsFormat === format.value,
        ),
      );
    renderSubmit(button, locked, !voiceSource || !node.body.trim());
    const emptyState =
        element.querySelector<HTMLElement>(".image-empty-state")!,
      voiceLabel = voiceSource
        ? `${voiceSource.voiceSettings?.roleName || "角色"} · ${sourceVoices.find((item) => item.id === voiceSource.voiceSettings?.voiceId)?.name || "默认音色"}`
        : "尚未连接角色声音",
      defaultTextPreview = "填写这一镜的对白、旁白或系统播报",
      rawTextPreview = node.body.trim() || defaultTextPreview,
      textPreview =
        rawTextPreview.length > defaultTextPreview.length
          ? `${rawTextPreview.slice(0, defaultTextPreview.length)}…`
          : rawTextPreview,
      content = `<header class="video-node-heading"><div><b>TTS 文本生成</b><small>${escapeHtml(voiceLabel)}</small></div></header><div class="voice-node-lines tts-node-text${node.body.trim() ? "" : " empty"}" title="${escapeHtml(rawTextPreview)}"><b>${escapeHtml(textPreview)}</b><small>${escapeHtml(node.ttsSettings?.emotion || "中性")} · ${escapeHtml((node.ttsSettings?.format || "mp3").toUpperCase())}</small></div><p>${locked ? "正在生成语音" : voiceSource ? "选中卡片，在下方调整文本与表达" : "连接语音配置卡片后即可生成"}</p>`;
    const renderKey = `tts-card:${content}`;
    if (emptyState.dataset.renderKey !== renderKey) {
      emptyState.dataset.renderKey = renderKey;
      emptyState.innerHTML = content;
    }
  }
  if (node.kind === "audio") {
    const audioMedia = element.querySelector<HTMLElement>(".node-media")!;
    if (audioPanel.parentElement !== audioMedia)
      audioMedia.append(audioPanel);
    const audio = audioPanel.querySelector<HTMLAudioElement>("audio")!,
      title = audioPanel.querySelector<HTMLElement>("[data-audio-title]")!,
      meta = audioPanel.querySelector<HTMLElement>("[data-audio-meta]")!,
      download = audioPanel.querySelector<HTMLButtonElement>(
        "[data-audio-download]",
      )!,
      toggle = audioPanel.querySelector<HTMLButtonElement>(
        "[data-audio-toggle]",
      )!;
    if (
      node.mediaUrl &&
      audio.src !== new URL(node.mediaUrl, location.href).href
    )
      audio.src = node.mediaUrl;
    if (!node.mediaUrl) audio.removeAttribute("src");
    title.textContent = node.title || "音频结果";
    meta.textContent = node.mediaUrl
      ? `${(node.ttsSettings?.format || "mp3").toUpperCase()}${node.ttsSettings?.duration ? ` · ${node.ttsSettings.duration.toFixed(1)} 秒` : ""}`
      : "等待生成";
    download.disabled = !node.mediaUrl;
    toggle.disabled = !node.mediaUrl;
    toggle.querySelector("span")!.textContent = audio.paused ? "▶" : "Ⅱ";
    toggle.setAttribute("aria-label", audio.paused ? "播放音频" : "暂停音频");
  }
  
}

