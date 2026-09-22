/** Internal, encrypted at rest; never include this in a public job response. */
export type AcceptedVideoTask = {
  provider: string
  id: string
  taskId?: string
  key: string
}

/** A query failure says nothing about the outcome of an accepted generation. */
export class TrackingDeferred extends Error {
  constructor(readonly retryMs = 15000) {
    super('上游任务已受理，暂时无法确认结果，正在自动继续查询原任务（不会重复生成）')
  }
}

export class TrackingStopped extends Error {}
