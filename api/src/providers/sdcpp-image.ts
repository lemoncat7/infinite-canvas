import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

type SubmitResponse = { id?:string; status?:string; error?:unknown }
type JobResponse = {
  id?:string
  status?:'queued'|'generating'|'completed'|'failed'|'cancelled'
  queue_position?:number|null
  error?:unknown
  result?:{ output_format?:string; images?:Array<{ b64_json?:string }> }
}

export class SdCppImageProvider implements GenerationProvider {
  readonly name='sdcpp-image'
  private readonly baseUrl=required('SDCPP_IMAGE_BASE_URL').replace(/\/$/,'')
  private readonly pollInterval=Math.max(500,Number(process.env.SDCPP_IMAGE_POLL_INTERVAL_MS||1200))
  private readonly timeout=Math.max(30000,Number(process.env.SDCPP_IMAGE_TIMEOUT_MS||600000))

  async available():Promise<boolean>{
    try{const result=await this.request<{backend?:string;models?:unknown}>('/sdcpp/v1/capabilities',undefined,2500);return Boolean(result&&typeof result==='object')}
    catch{return false}
  }

  async run(input:GenerationInput,onUpdate:(update:GenerationUpdate)=>void):Promise<GenerationUpdate>{
    if(input.kind!=='image')throw new Error('stable-diffusion.cpp Adapter 仅支持图片任务')
    const dimensions=parseDimensions(input.parameters?.size),quality=String(input.parameters?.quality||'auto'),steps=quality==='high'?12:quality==='low'?6:8,images=input.inputUrls||[]
    const body={
      prompt:input.prompt,negative_prompt:'blurry, distorted, low quality, text, watermark',width:dimensions.width,height:dimensions.height,batch_count:1,seed:-1,
      output_format:'png',output_compression:100,auto_resize_ref_image:true,increase_ref_index:false,strength:.72,
      init_image:images[0]||null,ref_images:images,
      sample_params:{scheduler:'simple',sample_method:'euler',sample_steps:steps,guidance:{txt_cfg:1,distilled_guidance:3.5}},
    }
    onUpdate({status:'running',progress:5})
    const submitted=await this.request<SubmitResponse>('/sdcpp/v1/img_gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},20000)
    if(!submitted.id)throw new Error(formatError(submitted.error)||'SD Server 未返回任务 ID')
    const started=Date.now();let lastStatus=''
    while(Date.now()-started<this.timeout){
      const job=await this.request<JobResponse>(`/sdcpp/v1/jobs/${encodeURIComponent(submitted.id)}`,undefined,15000)
      if(job.status!==lastStatus){lastStatus=String(job.status||'');onUpdate({status:'running',progress:job.status==='queued'?8:15})}
      if(job.status==='completed'){
        const encoded=job.result?.images?.[0]?.b64_json,format=job.result?.output_format||'png'
        if(!encoded)throw new Error('SD Server 任务完成但未返图片')
        const result:GenerationUpdate={status:'succeeded',progress:100,resultUrl:`data:image/${format==='jpg'?'jpeg':format};base64,${encoded}`};onUpdate(result);return result
      }
      if(job.status==='failed'||job.status==='cancelled')throw new Error(formatError(job.error)||`SD Server 任务${job.status==='failed'?'失败':'已取消'}`)
      await delay(this.pollInterval)
    }
    throw new Error(`SD Server 生成超时（${Math.round(this.timeout/1000)} 秒）`)
  }

  private async request<T>(path:string,init?:RequestInit,timeout=15000):Promise<T>{
    const target=new URL(`${this.baseUrl}${path}`),body=typeof init?.body==='string'?init.body:undefined
    return await new Promise<T>((resolve,reject)=>{
      const request=(target.protocol==='https:'?httpsRequest:httpRequest)(target,{method:init?.method||'GET',headers:{...(init?.headers as Record<string,string>|undefined),...(body?{'content-length':String(Buffer.byteLength(body))}:{})}},response=>{
        const chunks:Buffer[]=[]
        response.on('data',chunk=>chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)))
        response.on('end',()=>{const status=response.statusCode||0;let payload:T&{error?:unknown};try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8')) as T&{error?:unknown}}catch{payload={} as T&{error?:unknown}}if(status<200||status>=300){reject(new Error(formatError(payload.error)||`SD Server 返回 ${status}`));return}resolve(payload)})
      })
      request.setTimeout(timeout,()=>request.destroy(new Error(`请求超时（${Math.round(timeout/1000)} 秒）`)))
      request.on('error',error=>reject(new Error(`无法连接 SD Server：${error.message}`)))
      if(body)request.write(body)
      request.end()
    })
  }
}

function parseDimensions(value:unknown){const match=String(value||'').match(/^(\d+)x(\d+)$/),clamp=(number:number)=>Math.max(64,Math.min(2048,Math.round(number/8)*8));return match?{width:clamp(Number(match[1])),height:clamp(Number(match[2]))}:{width:512,height:512}}
function formatError(value:unknown){if(!value)return '';if(typeof value==='string')return value;if(typeof value==='object'&&value&&'message'in value)return String((value as {message?:unknown}).message||'');return String(value)}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}
function required(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required when using sdcpp-image`);return value}
