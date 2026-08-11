export function friendlyGenerationError(raw: string, fallback: string) {
  const text = raw.trim() || fallback;
  const lower = text.toLowerCase();
  const requestId = text.match(/request id\s*[:：]?\s*([a-z0-9-]+)/i)?.[1];
  const result = (title: string, message: string, advice: string) => ({
    title,
    message,
    advice,
    requestId,
  });
  if (/safety system|content.?policy|safety_violations|安全(?:系统|检查)|内容政策/.test(lower))
    return result("图片未通过安全检查", "提示词或参考图片可能触发了内容安全规则。", "尝试使用更中性的描述，移除危险动作；如果使用了参考图，请逐张排查或更换图片。");
  if (/\b401\b|unauthorized|invalid api key|incorrect api key|鉴权|密钥.*(?:无效|错误)/.test(lower))
    return result("接口认证失败", "当前 API 密钥无效、已过期或没有该模型权限。", "请检查接口地址、密钥和模型权限后重试。");
  if (/\b403\b|forbidden|permission denied|无权限/.test(lower))
    return result("接口没有访问权限", "当前账号或密钥无权执行这项生成任务。", "检查模型授权、账号权限或代理服务配置。");
  if (/\b429\b|rate.?limit|too many requests|quota|额度|请求过多/.test(lower))
    return result("请求过于频繁", "生成接口当前繁忙，或账号额度已经用完。", "稍后重试，并检查接口额度与并发限制。");
  if (/auth_unavailable|no auth available/.test(lower))
    return result("CPA 暂无可用账号", "CPA 的生图认证池当前没有可用账号。", "暂停重复提交，等待账号冷却后再试，或检查 CPA 的 Codex 认证状态。");
  if (/unexpected eof|backend-api\/codex\/images/.test(lower))
    return result("CPA 生图连接中断", "CPA 请求上游图片接口时连接被提前断开。", "这不是素材顺序错误；等待 CPA 恢复后重试，持续出现时请检查 CPA 日志和账号状态。");
  if (/结果保存到资产库失败|result archive|下载生成结果失败/.test(lower))
    return result("生成结果归档失败", "模型已经生成完成，但服务器下载结果并写入资产库时网络中断。", "这不是提示词或参考图问题；可以重试任务，若持续出现请检查结果地址与代理连接。");
  if (/timeout|timed out|aborted due to timeout|超时/.test(lower))
    return result("生成等待时间过长", "接口在限定时间内没有返回完整结果。", "稍后重试；复杂提示词可以切换为简洁模式，并减少参考图片数量。");
  if (/download.*image|image.*download|读取.*图片|参考图片.*(?:读取|下载)|首帧图片/.test(lower))
    return result("参考图片读取失败", "生成服务暂时无法访问其中一张参考图片。", "重新上传图片、检查公网地址，或稍后再试。");
  if (/未返回任务 id|没有.*task.?id|without.*(?:task|request).*id/.test(lower))
    return result("接口格式不兼容", "视频接口没有返回可用于查询进度的任务编号。", "检查所选模型与 Provider 适配方式是否匹配。");
  if (/\b5\d\d\b|bad gateway|service unavailable|internal server error|upstream/.test(lower))
    return result("生成服务暂时异常", "上游接口当前不可用或返回了服务端错误。", "稍后重试；如果持续发生，请检查 CPA 或模型服务日志。");
  return result("生成失败", fallback || "任务未能完成。", "可以重试一次；若仍然失败，请展开技术详情查看接口返回。");
}
