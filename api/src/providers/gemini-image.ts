import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

type GeminiPart = { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }
type GeminiResponse = { candidates?: Array<{ content?: { parts?: GeminiPart[] } }>; error?: { message?: string }; message?: string }

export class GeminiImageProvider implements GenerationProvider {
  readonly name = 'gemini-image'
  private readonly baseUrl:string
  private readonly apiKey:string

  constructor(config?:{baseUrl:string;apiKey:string}) {
    this.baseUrl=(config?.baseUrl||required('OPENAI_IMAGE_BASE_URL')).replace(/\/$/,'')
    this.apiKey=config?.apiKey||required('OPENAI_IMAGE_API_KEY')
  }

  async run(input:GenerationInput,onUpdate:(update:GenerationUpdate)=>void) {
    if(input.kind!=='image')throw new Error('Gemini Image Adapter 仅支持图片任务')
    const model=input.model||'gemini-3.1-flash-image'
    onUpdate({status:'running',progress:15})
    const parts:Array<Record<string,unknown>>=[{text:input.prompt}]
    for(const source of (input.inputUrls??[]).slice(0,8))parts.push({inlineData:await this.resolveImage(source)})
    const ratio=aspectRatio(input.parameters?.size)
    console.info('[gemini-image] generating',{internalJobId:input.internalJobId,model,imageCount:parts.length-1,aspectRatio:ratio})
    const response=await fetch(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:'POST',headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:ratio}}}),
      signal:AbortSignal.timeout(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS||180000)),
    })
    const payload=await response.json().catch(()=>({})) as GeminiResponse
    if(!response.ok)throw new Error(payload.error?.message||payload.message||`CPA Gemini image API returned ${response.status}`)
    const imagePart=payload.candidates?.flatMap(candidate=>candidate.content?.parts??[]).find(part=>part.inlineData?.data||part.inline_data?.data)
    const inline=imagePart?.inlineData??(imagePart?.inline_data?{mimeType:imagePart.inline_data.mime_type,data:imagePart.inline_data.data}:undefined)
    if(!inline?.data)throw new Error('CPA Gemini image API 未返回图片数据')
    const result:GenerationUpdate={status:'succeeded',progress:100,resultUrl:`data:${inline.mimeType||'image/png'};base64,${inline.data}`}
    onUpdate(result);return result
  }

  private async resolveImage(source:string) {
    if(source.startsWith('data:'))return parseDataUrl(source)
    const url=source.startsWith('/api/')?`http://127.0.0.1:${process.env.PORT??3000}/${source.slice(5)}`:source
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)})
    if(!response.ok)throw new Error(`读取 Gemini 参考图片失败（${response.status}）`)
    const bytes=Buffer.from(await response.arrayBuffer())
    if(!bytes.length||bytes.length>20*1024*1024)throw new Error('Gemini 参考图片为空或超过 20MB')
    return {mimeType:response.headers.get('content-type')?.split(';')[0]||'image/png',data:bytes.toString('base64')}
  }
}

function parseDataUrl(source:string){const match=source.match(/^data:([^;,]+);base64,(.+)$/s);if(!match)throw new Error('Gemini 参考图片格式无效');return {mimeType:match[1],data:match[2]}}
function aspectRatio(size:unknown){const ratios:Record<string,string>={'1024x1024':'1:1','1344x1008':'4:3','1008x1344':'3:4','1536x1024':'3:2','1024x1536':'2:3','1536x864':'16:9','864x1536':'9:16'};return ratios[String(size||'')]||'1:1'}
function required(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required when using gemini-image`);return value}
