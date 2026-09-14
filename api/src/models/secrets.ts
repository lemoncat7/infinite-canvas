import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { ModelConfigError } from './types.js'

/** Key is separate from exported model configuration. Missing keys never silently rotate. */
export class ModelSecrets {
  private readonly key: Buffer
  constructor(directory: string, hasConfiguration: boolean) {
    const path = `${directory}/model-config.key`
    if (!existsSync(path)) {
      if (hasConfiguration) throw new Error('模型加密密钥缺失，请恢复 model-config.key；不能生成新密钥覆盖')
      try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }) } catch (error) { if (!existsSync(path)) throw error }
    }
    if (process.platform !== 'win32' && (statSync(path).mode & 0o077)) throw new Error('model-config.key 权限必须为 600')
    this.key = readFileSync(path)
    if (this.key.length !== 32) throw new Error('模型加密密钥格式无效')
  }
  seal(value: unknown) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.')
  }
  open<T>(value: string): T {
    try {
      const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'))
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv)
      cipher.setAuthTag(tag)
      return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T
    } catch { throw new ModelConfigError('模型配置无法解密，请检查加密密钥或恢复备份', 503) }
  }
}
