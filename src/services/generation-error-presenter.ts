export function friendlyGenerationError(raw: string, fallback: string) {
  const text = raw.trim() || fallback;
  const lower = text.toLowerCase();
  const requestId = text.match(/request[ _-]?id\s*[:：]?\s*([a-z0-9_-]{8,128})\b/i)?.[1];
  const result = (title: string, message: string, advice: string) => ({
    title,
    message,
    advice,
    requestId,
  });
  if (/参考图(?:片)?.*(?:数量超出|数量不符合|最多|上限|至少|不支持多图)|最多.*张参考图/.test(text))
    return result("参考图数量不符合要求", text, "调整已连接的参考图片数量，或选择支持该数量的模型后再提交；直接重试不会解决数量限制。");
  if (/(?:参考图|首帧图片).*(?:尺寸|大小|超过|小于|MiB|MB|像素)/i.test(text))
    return result("参考图片尺寸或大小不符合要求", text, "按提示调整对应图片的尺寸或文件大小，再重新提交。");
  if (/safety system|content.?policy|safety_violations|安全(?:系统|检查|审核)|内容政策/.test(lower))
    return result("图片未通过安全审核", "上游安全系统拒绝了本次生成，未说明具体触发项。", "请确认提示词和参考图片符合服务商的内容规则；若认为是误判，可提供技术详情中的 Request ID 联系服务商。");
  if (/透明背景验收失败/.test(text))
    return result("透明背景验收失败", "生成图片不含有效透明通道，未满足所选透明背景要求。", "如不需要透明背景，可关闭该选项；需要时请检查模型是否支持透明输出。");
  if (/模型参数校验失败|forbidden field|extra inputs are not permitted/.test(lower))
    return result("生成参数不受支持", "请求包含该模型不接受的参数。", "检查尺寸、质量等参数和模型适配方式；这不是密钥失效，直接重试不会修正参数。");
  if (/auth_unavailable|no auth available|没有可用认证资源/.test(lower))
    return result("上游暂无可用认证资源", "服务商的模型渠道当前没有可用账号或认证资源。", "请检查服务商渠道状态；不代表你填写的 API Key 已失效。");
  if (/\b401\b|unauthorized|invalid api key|incorrect api key|认证失败|鉴权|密钥.*(?:无效|错误)/.test(lower))
    return result("接口认证失败", "当前 API 密钥无效、已过期或没有该模型权限。", "请检查接口地址、密钥和模型权限后重试。");
  if (/\b403\b|forbidden|permission denied|无权限/.test(lower))
    return result("接口没有访问权限", "当前账号或密钥无权执行这项生成任务。", "检查模型授权、账号权限或代理服务配置。");
  if (/insufficient_quota|quota.?exceeded|额度不足|余额不足/.test(lower))
    return result("模型服务额度不足", "服务商余额或配额不足，无法完成生成。", "检查服务商账户的余额与配额后再提交。");
  if (/\b429\b|rate.?limit|too many requests|请求过多|请求过于频繁/.test(lower))
    return result("请求过于频繁", "上游接口触发了请求频率限制。", "稍后重试，并检查接口并发限制。");
  if (/队列已满|queue.*full/.test(lower))
    return result("模型服务队列已满", "上游当前没有空闲生成名额。", "若任务显示等待重试，无需重复提交；否则可稍后再试。");
  if (/\beof\b|连接中断|econnreset|socket hang up/.test(lower))
    return result("上游连接中断", "连接在返回完整生成结果前被关闭，不是达到等待时限。", "先确认上游任务是否完成，避免重复提交；持续出现时检查服务商连接和代理。");
  if (/结果保存到资产库失败|result archive|下载生成结果失败/.test(lower))
    return result("生成结果归档失败", "模型已经生成完成，但服务器下载结果并写入资产库时网络中断。", "这不是提示词或参考图问题；可以重试任务，若持续出现请检查结果地址与代理连接。");
  if (/参考图片读取超时/.test(text))
    return result("参考图片读取超时", "读取参考图片时超过等待时限，尚未提交生图请求。", "检查图片地址或重新上传图片，再提交任务。");
  if (/timeout|timed out|aborted due to timeout|超时/.test(lower)) {
    const seconds = text.match(/(\d+)\s*秒等待上限/)?.[1];
    return result("生成等待超时", seconds ? `本次请求已达到 ${seconds} 秒等待上限，仍未收到完整结果。` : "在等待时限内未收到完整结果；旧记录可能没有保留具体阶段。", "先确认上游任务是否仍在执行，避免重复生成或计费；如经常达到上限，请管理员检查等待时限与服务商耗时。");
  }
  if (/network|网络连接失败|econnrefused|fetch failed/.test(lower))
    return result("模型服务网络异常", "连接模型服务时失败，未取得完整生成结果。", "检查服务商可用性和代理连接，并确认上游任务状态后再试。");
  if (/download.*image|image.*download|读取.*图片|参考图片.*(?:读取|下载)|首帧图片/.test(lower))
    return result("参考图片读取失败", "生成服务暂时无法访问其中一张参考图片。", "重新上传图片、检查公网地址，或稍后再试。");
  if (/未返回任务 id|没有.*task.?id|without.*(?:task|request).*id/.test(lower))
    return result("接口格式不兼容", "视频接口没有返回可用于查询进度的任务编号。", "检查所选模型与 Provider 适配方式是否匹配。");
  if (/响应格式异常|未返回图片结果/.test(text))
    return result("模型返回结果格式异常", "接口没有返回可用图片结果。", "检查模型和接口适配是否匹配；技术详情中的 HTTP 状态可帮助定位。");
  if (/上游拒绝生成请求/.test(text))
    return result("上游拒绝生成请求", "接口拒绝了请求，但没有提供可识别的具体原因。", "核对模型参数及输入要求，并提供技术详情给服务商；不能仅凭 HTTP 400 判断为审核拒绝。");
  if (/模型或接口不存在/.test(text))
    return result("模型或接口不存在", "当前模型 ID 或接口路径不可用。", "核对服务商模型列表、接口地址与适配类型。");
  if (/模型调用失败.*正文已隐藏/.test(text))
    return result("生成失败，具体原因未记录", "这条错误没有保留可识别的失败原因，无法仅凭此提示判断是网络、审核还是配置问题。", "请根据任务时间检查服务端或上游日志；旧记录不会自动恢复已丢失的原因。");
  if (/\b5\d\d\b|bad gateway|service unavailable|internal server error|upstream/.test(lower))
    return result("生成服务暂时异常", "上游接口当前不可用或返回了服务端错误。", "稍后重试；如果持续发生，请检查 CPA 或模型服务日志。");
  return result("生成失败", fallback || "任务未能完成。", "可以重试一次；若仍然失败，请展开技术详情查看接口返回。");
}
