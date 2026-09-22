export type KeyFailure = 'rate-limit' | 'quota' | 'authentication'

/** Only credential-level failures may suppress every model using a Key. */
export function keyFailure(status: number, message: string): KeyFailure | undefined {
  if (status >= 500) return undefined
  if (status === 402 || /insufficient[_ -]quota|quota[_ -](?:exceeded|exhausted)|insufficient (?:balance|credits)|credit balance|余额不足|额度不足/i.test(message)) return 'quota'
  if (status === 429) return 'rate-limit'
  if (/auth_unavailable|no auth available|forbidden field|extra inputs are not permitted/i.test(message)) return undefined
  if (status === 401) return 'authentication'
  // A generic 403 may mean model permissions, IP policy or WAF, not a bad Key.
  if (status === 403 && /invalid[_ -](?:api[_ -])?(?:key|token)|(?:api[_ -]?key|token)[_ -](?:invalid|expired|revoked)|incorrect api key|无效.{0,6}(?:密钥|令牌)/i.test(message)) return 'authentication'
  return undefined
}
