import { api as transport, currentApiUrl, peekTransportCache, type ApiRequestInit } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";

export * from "./api-transport";
const normalized = new WeakMap<object, { origin: string; value: unknown }>();
function normalize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const origin = currentApiUrl();
  const saved = normalized.get(value);
  if (saved?.origin === origin) return saved.value as T;
  const result = normalizeMediaLinks(value, origin);
  normalized.set(value, { origin, value: result });
  return result;
}
export async function api<T>(path: string, init: ApiRequestInit & {onAIProgress?:(stage:'reading'|'analysing'|'finishing')=>void} = {}, canRefresh = true): Promise<T> {
  const {onAIProgress,...request}=init;
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const statusRead=new AbortController();
  if(path==='/v1/ai'&&request.method==='POST'&&onAIProgress&&typeof request.body==='string'){
    let id='';try{id=JSON.parse(request.body).idempotencyKey??'';}catch{/* Invalid payloads are rejected by the API. */}
    if(/^[a-f0-9-]{36}$/i.test(id)){
      const poll=async()=>{
        if(!active||request.signal?.aborted)return;
        try{
          const result=await transport<{status:string;stage?:string}>('/v1/ai/requests/'+id,{cache:'no-store',timeoutMs:5000,signal:statusRead.signal});
          if(active&&!request.signal?.aborted&&['reading','analysing','finishing'].includes(result.stage??''))onAIProgress(result.stage as 'reading'|'analysing'|'finishing');
        }catch{/* The submission reports failures; a status-read interruption cannot hide its result. */}
        if(active&&!request.signal?.aborted)timer=setTimeout(()=>void poll(),2500);
      };
      timer=setTimeout(()=>void poll(),1000);
    }
  }
  try{return normalize(await transport<T>(path, request, canRefresh));}
  finally{active=false;if(timer)clearTimeout(timer);statusRead.abort();}
}
export function peekApiCache<T>(path: string, options: { allowStale?: boolean } = {}): T | undefined {
  const saved = peekTransportCache<T>(path, options);
  return saved === undefined ? undefined : normalize(saved);
}
