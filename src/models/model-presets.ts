/** Known upstream contracts only; unknown model names must not imply an API protocol. */
export function bindKnownModelPreset(form: HTMLFormElement) {
  const model = form.querySelector<HTMLInputElement>('[name=model]')!
  model.addEventListener('input', () => {
    if (!/^agnes-video-2\.5(?:-flash)?$/.test(model.value.trim())) return
    const flash = model.value.trim().endsWith('-flash')
    const values = { adapter: 'agnes-video', referenceImages: flash ? '5' : '8', minSeconds: '4', maxSeconds: '12', resolutions: flash ? '720p' : '720p, 1080p, 1k, 2k', aspectRatios: '21:9, 16:9, 4:3, 1:1, 3:4, 9:16' }
    for (const [name, value] of Object.entries(values)) {
      const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`)
      if (input) input.value = value
    }
    form.querySelector('[name=adapter]')!.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
