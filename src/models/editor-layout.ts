/** A single scroll region with a separate, always reachable save footer. */
export function layoutEditorForm(form: HTMLFormElement) {
  const body = document.createElement('div')
  body.className = 'model-editor-body'
  const footer = form.querySelector(':scope > footer')
  for (const child of [...form.children]) if (child !== footer) body.append(child)
  form.prepend(body)
}
