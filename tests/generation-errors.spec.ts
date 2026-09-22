import { test, expect } from '@playwright/test';
import { friendlyGenerationError } from '../src/services/generation-error-presenter';

test('sanitized errors keep distinct actionable reasons', () => {
  for (const [raw, title] of [
    ['上游安全审核拒绝（HTTP 400）', '图片未通过安全审核'],
    ['上游连接中断（network）（HTTP 500）', '上游连接中断'],
    ['模型参数校验失败：不是密钥认证失败', '生成参数不受支持'],
    ['参考图片读取超时', '参考图片读取超时'],
    ['上游拒绝生成请求（HTTP 400）', '上游拒绝生成请求'],
    ['模型响应格式异常：未获得可用图片结果', '模型返回结果格式异常'],
    ['模型调用失败，上游错误正文已隐藏', '生成失败，具体原因未记录'],
  ]) expect(friendlyGenerationError(raw, '失败').title).toBe(title);
  expect(friendlyGenerationError('模型等待超时：已达到本次请求 180 秒等待上限', '失败').message).toContain('180 秒');
});

test('reference count errors are visible without opening technical details', () => {
  for (const message of [
    '参考图数量超出配置：当前 6 张，模型「测试」配置上限为 5 张。',
    '该模型最多支持 0 张参考图',
    'Agnes Video 2.5 Flash 参考图最多 5 张',
    'Grok 多图视频最多支持 7 张参考图片',
  ]) {
    const result = friendlyGenerationError(message, '任务提交失败，请检查接口配置');
    expect(result.title).toBe('参考图数量不符合要求');
    expect(result.message).toBe(message);
    expect(result.advice).toContain('直接重试不会解决');
  }
});

test('image size errors are not mislabeled as download failures', () => {
  const message = '首帧图片为空或超过 15MB';
  expect(friendlyGenerationError(message, '失败').title).toBe('参考图片尺寸或大小不符合要求');
  expect(friendlyGenerationError('参考图片下载失败', '失败').title).toBe('参考图片读取失败');
});
