/** Copy a portable HTTP configuration, never a DSH-private credential handle. */
export function mcpClientConfig(origin: string) {
  const url = new URL('/api/mcp', origin)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请通过 HTTP 或 HTTPS 网页地址复制 MCP 配置')
  return JSON.stringify({
    transport: 'streamable-http',
    url: url.href,
    headers: { Authorization: 'Bearer YOUR_API_TOKEN' },
  }, null, 2)
}

export function bindMcpConfigCopy(section: HTMLElement) {
  const title = section.querySelector('small')!
  const header = document.createElement('header')
  header.className = 'user-token-heading'
  title.before(header); header.append(title)
  const button = document.createElement('button')
  button.type = 'button'; button.textContent = '复制 MCP 配置'; button.dataset.mcpCopy = ''
  header.append(button)
  const help = document.createElement('p')
  help.className = 'mcp-config-help'
  help.textContent = '将 YOUR_API_TOKEN 替换为你的 API Token。'
  const output = document.createElement('output')
  output.className = 'mcp-copy-status'; output.setAttribute('aria-live', 'polite')
  const manual = document.createElement('textarea')
  manual.readOnly = true; manual.hidden = true; manual.rows = 7
  manual.setAttribute('aria-label', 'MCP 配置，自动复制失败时可手动复制')
  section.append(help, output, manual)
  button.addEventListener('click', async () => {
    button.disabled = true; output.textContent = ''; manual.hidden = true
    try {
      const config = mcpClientConfig(window.location.origin)
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(config)
        output.textContent = 'MCP 配置已复制'
      } catch {
        manual.value = config; manual.hidden = false; manual.focus(); manual.select()
        output.textContent = '浏览器不允许自动复制，请复制下方已选中的配置。'
      }
    } catch (error) { output.textContent = (error as Error).message }
    finally { button.disabled = false }
  })
}
