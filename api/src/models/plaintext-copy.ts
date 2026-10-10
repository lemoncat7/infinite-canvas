import { writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

/** Diagnostic copy only. Never a configuration source or a recovery fallback. */
export function savePlaintextModelCopy(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    const fd = openSync(temp, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, path)
  } catch {
    // A diagnostic copy must not change the authoritative encrypted save result.
    // Never log the configuration, credentials, or raw filesystem error.
    console.warn('[models] model-config-decrypt.json could not be updated; encrypted configuration remains authoritative')
  } finally {
    try { unlinkSync(temp) } catch { /* Already renamed or never created. */ }
  }
}
