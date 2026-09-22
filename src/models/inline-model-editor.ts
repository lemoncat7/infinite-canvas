import type { AdminModels } from './admin-api'
import type { CatalogModel, Purpose } from './catalog'
import { adapters, escape, purposes } from './admin-views'
import { modelPurposes, purposeKinds } from './model-purpose'
import { bindKnownModelPreset } from './model-presets'

const field = (name: string, title: string, value: unknown, attrs = '') => `<label>${title}<input name="${name}" value="${escape(value)}" ${attrs}></label>`

export function inlineModelForm(state: AdminModels, providerId: string, model?: CatalogModel, upstreamId = '') {
  const c = model?.capabilities
  const selected = model ? modelPurposes(model) : ['image']
  return `<form class="model-inline-form" aria-label="${model ? '配置 ' + escape(model.name) : '添加模型'}" data-inline-model>
    <output class="model-feedback" tabindex="-1" aria-live="polite"></output>
    <input type="hidden" name="providerId" value="${escape(providerId)}">
    <div class="model-inline-title"><h4>${model ? '模型配置' : '添加模型'}</h4><span>${escape(state.providers.find(p => p.id === providerId)?.name)}</span></div>
    <div class="model-fields-grid">${field('name', '显示名称', model?.name || upstreamId, 'required maxlength="120"')}${field('model', '模型 ID', model?.model || upstreamId, 'required maxlength="120" spellcheck="false"')}
    <label>接口协议<select name="adapter">${Object.entries(adapters).map(([key, title]) => `<option value="${key}" ${model?.adapter === key ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
    <label class="model-check model-enable"><input type="checkbox" name="enabled" ${model?.enabled !== false ? 'checked' : ''}>启用此模型</label></div>
    <section class="model-usage"><h4>用于什么</h4><div class="model-purpose-options">${Object.entries(purposes).map(([key, title]) => `<label class="model-purpose-option" data-purpose-kind="${purposeKinds[key as Purpose]}"><input type="checkbox" name="purposes" value="${key}" ${selected.includes(key as Purpose) ? 'checked' : ''}>${title}</label>`).join('')}</div><p class="model-help">按用途参与选择；文本模型可同时用于提示词助手和漫画规划。</p></section>
    <div class="model-fields-grid model-budget">${field('order', '优先级', model?.order ?? 100, 'type="number" min="0" max="10000" required')}${field('creditCost', '每次生成点数', model?.creditCost ?? 0, 'type="number" min="0" max="100000" required')}</div><p class="model-help">优先级数字越小越优先。默认设为“自动分配”时生效；点数为 0 表示免费，文本暂不计费。</p>
    <details class="model-advanced"><summary>能力与生成参数</summary><div class="model-fields-grid">${field('referenceImages', '最多参考图', c?.referenceImages ?? 0, 'type="number" min="0" max="32"')}<label class="model-check" data-image-capability><input name="transparent" type="checkbox" ${c?.transparent ? 'checked' : ''}>支持透明背景</label></div><div data-image-capability>${field('sizes', '图片尺寸（逗号分隔）', c?.sizes.join(', ') || '', 'placeholder="auto, 1024x1024"')}</div><div data-video-capability><div class="model-fields-grid">${field('resolutions', '分辨率（逗号分隔）', c?.resolutions.join(', ') || '', 'placeholder="720p, 1080p"')}${field('aspectRatios', '画幅（逗号分隔）', c?.aspectRatios.join(', ') || '', 'placeholder="16:9, 9:16"')}${field('minSeconds', '最短秒数', c?.minSeconds ?? 1, 'type="number" min="1" max="600"')}${field('maxSeconds', '最长秒数', c?.maxSeconds ?? 18, 'type="number" min="1" max="600"')}</div></div></details>
    <footer>${model?.enabled && model.kind !== 'text' ? '<button type="button" data-model-test>实际生成测试</button>' : ''}<button type="button" data-inline-cancel>取消</button><button type="submit" class="model-primary">保存模型</button></footer></form>`
}

export function bindInlineModelForm(form: HTMLFormElement, isNew: boolean) {
  const adapter = form.querySelector<HTMLSelectElement>('[name=adapter]')!
  let kind = adapter.value.endsWith('video') ? 'video' : adapter.value.endsWith('image') ? 'image' : 'text'
  const refresh = () => {
    const next = adapter.value.endsWith('video') ? 'video' : adapter.value.endsWith('image') ? 'image' : 'text'
    form.querySelectorAll<HTMLElement>('[data-purpose-kind]').forEach(label => {
      const input = label.querySelector<HTMLInputElement>('input')!
      const enabled = label.dataset.purposeKind === next
      label.hidden = !enabled; input.disabled = !enabled
      if (kind !== next) input.checked = enabled
    })
    form.querySelectorAll<HTMLElement>('[data-image-capability]').forEach(el => el.hidden = next !== 'image')
    form.querySelectorAll<HTMLElement>('[data-video-capability]').forEach(el => el.hidden = next !== 'video')
    const cost = form.querySelector<HTMLInputElement>('[name=creditCost]')!
    cost.readOnly = next === 'text'; if (next === 'text') cost.value = '0'
    kind = next
  }
  adapter.addEventListener('change', refresh)
  if (isNew) bindKnownModelPreset(form)
  refresh()
  if (isNew) form.querySelector('[name=model]')!.dispatchEvent(new Event('input', { bubbles: true }))
}

export function inlineModelDraft(form: HTMLFormElement) {
  const data = new FormData(form), values = Object.fromEntries(data) as Record<string, unknown>
  const split = (key: string) => String(values[key] || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
  return { ...values, enabled: data.has('enabled'), purposes: data.getAll('purposes'), capabilities: { referenceImages: Number(values.referenceImages), transparent: data.has('transparent'), sizes: split('sizes'), resolutions: split('resolutions'), aspectRatios: split('aspectRatios'), minSeconds: Number(values.minSeconds), maxSeconds: Number(values.maxSeconds) } }
}
