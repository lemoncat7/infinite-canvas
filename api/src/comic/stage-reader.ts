import { ProxyAgent, fetch as undiciFetch } from "undici";
import { parseFirstJsonObject } from "./json.js";
import { ComicStreamState } from "./stream-state.js";

type Emit = (event: Record<string, unknown>) => void;
type Log = { info(value: unknown, message?: string): void; warn(value: unknown, message?: string): void };

export function createComicStageReader(options: {
  baseUrl: string; apiKey: string; model: string; proxyUrl?: string;
  headerTimeout: number; idleTimeout: number; state: ComicStreamState;
  emit: Emit; log: Log;
}) {
  const candidates = [options.model, options.model, options.model, ...(options.model === "gpt-5.4-mini" ? [] : ["gpt-5.4-mini", "gpt-5.4-mini"])]
  const readStage = async (
    stage: string, system: string, content: unknown, maxTokens: number,
    progressStart: number, progressEnd: number, holdProgress = false, formatRetry = false,
  ): Promise<Record<string, unknown>> => {
    let body: ReadableStream<Uint8Array> | undefined, activeController: AbortController | undefined, lastError = "", stageContentAt = Date.now();
    options.state.touch();
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      options.state.usedModel = candidates[attempt];
      if (attempt) {
        options.emit({ type:"progress", progress:progressStart, phase:options.state.usedModel === candidates[attempt - 1] ? `${stage}上游暂时异常，正在自动重试…` : `${stage}正在切换备用线路…` });
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException("漫剧上游连接超时", "TimeoutError")), options.headerTimeout);
      const requestOptions = {
        method:"POST", headers:{ authorization:`Bearer ${options.apiKey}`, "content-type":"application/json" },
        body:JSON.stringify({ model:options.state.usedModel, stream:true, stream_options:{include_usage:true}, reasoning_effort:"low", temperature:0.38,
          max_tokens:maxTokens, response_format:{type:"json_object"}, messages:[{role:"system",content:system},{role:"user",content}] }), signal:controller.signal,
      };
      try {
        const response = options.proxyUrl
          ? await undiciFetch(`${options.baseUrl}/v1/chat/completions`, { ...requestOptions, dispatcher:new ProxyAgent(options.proxyUrl) })
          : await fetch(`${options.baseUrl}/v1/chat/completions`, requestOptions);
        clearTimeout(timer);
        if (response.ok && response.body) { body = response.body as ReadableStream<Uint8Array>; activeController = controller; stageContentAt = Date.now(); options.state.touch(); break; }
        lastError = `${response.status} ${(await response.text()).slice(0,300)}`;
        options.log.warn({stage,attempt:attempt+1,model:options.state.usedModel,status:response.status}, "comic stage upstream unavailable");
      } catch (error) {
        clearTimeout(timer); lastError = error instanceof Error ? error.message : String(error);
        options.log.warn({stage,attempt:attempt+1,model:options.state.usedModel,message:lastError}, "comic stage upstream retry");
      }
    }
    if (!body) throw new Error(lastError || `${stage}未返回响应流`);
    const reader = body.getReader(), decoder = new TextDecoder();
    let buffer = "", raw = "", lastProgress = progressStart;
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { activeController?.abort(); reject(new DOMException(`${stage}连续无正文数据`, "TimeoutError")); }, Math.max(1000, options.idleTimeout - (Date.now() - stageContentAt))); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, {stream:true});
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data)?.choices?.[0]?.delta || {};
          if (delta.reasoning_content || delta.reasoning) { stageContentAt = Date.now(); options.state.touch(); }
          const text = String(delta.content || ""); if (!text) continue;
          raw += text; stageContentAt = Date.now(); options.state.addContent(text);
          const progress = holdProgress ? progressStart : Math.min(progressEnd - 1, progressStart + Math.floor(raw.length / Math.max(90, maxTokens / 18)));
          options.state.advance(progress);
          if (progress > lastProgress) { lastProgress = progress; options.emit({type:"progress",progress:options.state.progress,phase:stage,receivedBytes:options.state.receivedBytes}); }
        } catch { /* upstream keepalive */ }
      }
    }
    if (!raw.trim()) throw new SyntaxError(`${stage}返回为空`);
    let extracted: ReturnType<typeof parseFirstJsonObject>;
    try { extracted = parseFirstJsonObject(raw, stage); }
    catch (error) {
      if (error instanceof SyntaxError && !formatRetry) {
        options.log.warn({stage,model:options.state.usedModel,responseLength:raw.length,message:error.message}, "comic stage invalid json retry");
        options.emit({type:"progress",progress:progressStart,phase:`${stage}格式异常，正在重新生成本阶段…`,receivedBytes:options.state.receivedBytes});
        return readStage(stage, system, content, maxTokens, progressStart, progressEnd, holdProgress, true);
      }
      throw error;
    }
    options.log.info({stage,model:options.state.usedModel,elapsedMs:Date.now()-options.state.startedAt,responseLength:raw.length,trailingLength:extracted.trailingLength,holdProgress}, "comic stage received");
    if (extracted.trailingLength) options.log.warn({stage,model:options.state.usedModel,trailingLength:extracted.trailingLength}, "comic stage ignored trailing model output");
    options.state.advance(holdProgress ? progressStart : progressEnd);
    options.emit({type:"progress",progress:options.state.progress,phase:`${stage}已完成`,receivedBytes:options.state.receivedBytes});
    return extracted.value;
  };
  return readStage;
}
