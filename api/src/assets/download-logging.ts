import type { ServerResponse } from 'node:http'
import type { ApplicationLogger } from '../core/logging.js'

/** finish means handed to the socket, not acknowledged by the remote image fetcher. */
export function observeAssetDownload(response: ServerResponse, log: ApplicationLogger, context: { requestId: string; assetId: string; method: string }) {
  const started = performance.now(), socket = response.socket, initialWritten = socket?.bytesWritten || 0
  let expectedBytes: number | undefined, outcome = 'pending', complete = false
  const finish = (event: 'finished' | 'interrupted' | 'error') => {
    if (complete) return
    complete = true
    response.off('finish', onFinish)
    response.off('close', onClose)
    const fields = { ...context, event: `reference_download_${event}`, outcome, status: response.statusCode,
      expectedBytes, socketBytesWritten: socket ? Math.max(0, socket.bytesWritten - initialWritten) : undefined,
      elapsedMs: Math.round(performance.now() - started), writableFinished: response.writableFinished }
    if (event === 'finished') log.info(fields, 'reference download response finished (not remote receipt confirmation)')
    else log.warn(fields, 'reference download response interrupted')
  }
  const onFinish = () => finish('finished'), onClose = () => finish(response.writableFinished ? 'finished' : 'interrupted')
  response.once('finish', onFinish)
  response.once('close', onClose)
  log.info({ ...context, event: 'reference_download_started' }, 'reference download request started')
  return {
    ready(bytes: number) { expectedBytes = bytes; outcome = 'asset' },
    rejected(reason: 'invalid_signature' | 'missing_asset' | 'file_read_failed') { outcome = reason },
  }
}
