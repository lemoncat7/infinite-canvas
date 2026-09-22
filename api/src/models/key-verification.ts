import { connectionKeys, credentialId, providerKeyPool, discoveryKeyPool, providerKeyStatus } from './key-pool.js'
import { apiRoot, rawModelFetch } from './network.js'
import { ModelConfigError, type ProviderConnection } from './types.js'

/** One saved credential, one non-billable request, no config mutation or generation replay. */
export async function verifyProviderKey(connection: ProviderConnection, id: unknown) {
  const key = connectionKeys(connection).find(key => credentialId(key) === id)
  if (!key) throw new ModelConfigError('此 Key 已移除或未保存，请刷新配置', 404)
  await providerKeyPool.verifyAuthentication(connection, key, () => discoveryKeyPool.verifyAuthentication(connection, key, async () => {
    let response: Response
    try {
      response = await rawModelFetch(`${apiRoot(connection.baseUrl)}/v1/models`, {
        headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
      }, connection.proxyUrl, 2 * 1024 * 1024)
    } catch { throw new ModelConfigError('验证连接失败或超时，原冷却状态未改变', 502) }
    if (!response.ok) throw new ModelConfigError(`验证返回 HTTP ${response.status}，原冷却状态未改变；模型列表权限与生成权限可能不同`, 502)
    const body = await response.json().catch(() => null) as { data?: unknown } | null
    if (!Array.isArray(body?.data)) throw new ModelConfigError('接口未返回标准模型列表，无法确认恢复，原冷却状态未改变', 502)
  }))
  const status = providerKeyStatus(connection).find(k => k.id === id)!
  return { key: status, message: status.status === 'cooling'
    ? '模型列表验证通过；生成冷却仍保留，列表访问成功不能证明生成额度或限流已恢复。'
    : status.discovery.status === 'cooling' ? '模型列表验证通过，认证冷却已解除；查询列表的限流或额度冷却仍保留。'
    : '模型列表验证通过，认证冷却已解除；不代表所有模型均有生成权限。' }
}
