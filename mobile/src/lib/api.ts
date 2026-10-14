import { api as transport, ApiError, currentApiUrl, peekTransportCache, type ApiRequestInit } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";
import { waitForRequest } from './request-policy';

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
  const started = Date.now();
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  let requestId = '', completed: T | undefined;
  const statusRead=new AbortController();
  if(path==='/v1/ai'&&request.method==='POST'&&typeof request.body==='string'){
    let id='';try{id=JSON.parse(request.body).idempotencyKey??'';}catch{/* Invalid payloads are rejected by the API. */}
    if(/^[a-f0-9-]{36}$/i.test(id)){
      requestId = id;
      const poll=async()=>{
        if(!active||request.signal?.aborted)return;
        try{
          const result=await transport<T & {status:string;stage?:string}>('/v1/ai/requests/'+id,{cache:'no-store',timeoutMs:5000,signal:statusRead.signal});
          if (result.status === 'completed') { completed = result; return; }
          if(active&&!request.signal?.aborted&&['reading','analysing','finishing'].includes(result.stage??''))onAIProgress?.(result.stage as 'reading'|'analysing'|'finishing');
        }catch{/* The submission reports failures; a status-read interruption cannot hide its result. */}
        if(active&&!request.signal?.aborted)timer=setTimeout(()=>void poll(),2500);
      };
      timer=setTimeout(()=>void poll(),1000);
    }
  }
  try{return normalize(await transport<T>(path, request, canRefresh));}
  catch (caught) {
    if (!requestId || request.signal?.aborted || !(caught instanceof ApiError) || !(caught.status === 0 || caught.details?.reason === 'AI_PROCESSING')) throw caught;
    if (completed) return normalize(completed);
    // A lost response or a duplicate tap checks the already reserved request.
    // Never submit a second paid inference merely to recover its result.
    const deadline = Math.max(started + (request.timeoutMs ?? 120000), Date.now() + 5000);
    while (Date.now() < deadline && !request.signal?.aborted) {
      try {
        const result = await transport<T & {status:string;stage?:string}>('/v1/ai/requests/' + requestId, {cache:'no-store', timeoutMs:Math.min(5000, deadline-Date.now()), signal:request.signal ?? null});
        if (result.status === 'completed') return normalize(result);
        if (['reading','analysing','finishing'].includes(result.stage ?? '')) onAIProgress?.(result.stage as 'reading'|'analysing'|'finishing');
      } catch (error) {
        if (error instanceof ApiError && error.status !== 0 && error.status !== 404) throw error;
      }
      let pause:ReturnType<typeof setTimeout>|undefined;
      try { await waitForRequest(new Promise<void>(resolve=>{pause=setTimeout(resolve,Math.min(2500,Math.max(1,deadline-Date.now())));}), request.signal); }
      finally { if (pause) clearTimeout(pause); }
    }
    throw caught;
  }
  finally{active=false;if(timer)clearTimeout(timer);statusRead.abort();}
}
export function peekApiCache<T>(path: string, options: { allowStale?: boolean } = {}): T | undefined {
  const saved = peekTransportCache<T>(path, options);
  return saved === undefined ? undefined : normalize(saved);
}
