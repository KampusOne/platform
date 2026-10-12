import type { Bindings } from '../types';
export type LiveChange = { id: string; prefixes: string[] };
/** Resource invalidations only: no message bodies, identities, prices, tokens or location data. */
export function validLiveChange(value:unknown):value is LiveChange {
  if(!value||typeof value!=='object')return false;
  const change=value as LiveChange;
  return Object.keys(change).every(key=>key==='id'||key==='prefixes')&&typeof change.id==='string'&&change.id.length>0&&change.id.length<=120&&Array.isArray(change.prefixes)&&change.prefixes.length>0&&change.prefixes.length<=8&&change.prefixes.every(path=>typeof path==='string'&&/^\/v1\/(messages\/(?:inbox|threads\/[a-f0-9-]{36})|notifications\/inbox|agents)$/.test(path));
}
export function liveScope(userId:string,institutionId:string|null) { return JSON.stringify([userId,institutionId]); }
export async function publishUserReads(env:Bindings,userId:string,institutionId:string|null,change:LiveChange) {
  if(env.LIVE_UPDATES_ENABLED!=='true'||!env.LIVE_USERS||!validLiveChange(change))return;
  const stub=env.LIVE_USERS.get(env.LIVE_USERS.idFromName(liveScope(userId,institutionId)));
  const response=await stub.fetch('https://live.internal/change',{method:'POST',signal:AbortSignal.timeout(1500),body:JSON.stringify({id:change.id,prefixes:change.prefixes})});
  if(response&&!response.ok)throw new Error('Live invalidation could not be accepted.');
}
/** One authenticated user/tenant hub with hibernating sockets and short authorization leases. */
export class LiveUser {
  constructor(private ctx:DurableObjectState) {}
  async fetch(request:Request) {
    const path=new URL(request.url).pathname;
    if(path==='/change'&&request.method==='POST') {
      const change:unknown=await request.json();if(!validLiveChange(change))return new Response(null,{status:400});
      const saved=await this.ctx.storage.get<{sequence:number;seen:string[]}>('cursor')??{sequence:0,seen:[]};
      if(saved.seen.includes(change.id))return new Response(null,{status:204});
      const sequence=saved.sequence+1;
      await this.ctx.storage.put('cursor',{sequence,seen:[...saved.seen,change.id].slice(-128)});
      const event=JSON.stringify({type:'change',sequence,prefixes:change.prefixes});
      for(const socket of this.ctx.getWebSockets()) {
        const lease=socket.deserializeAttachment() as {expiresAt:number};
        if(!lease||lease.expiresAt<=Date.now()){socket.close(4001,'Authorization lease expired');continue;}
        try{socket.send(event);}catch{socket.close(1011,'Reconnect to reconcile');}
      }
      return new Response(null,{status:204});
    }
    if(path!=='/connect'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response(null,{status:404});
    const expiresAt=Number(request.headers.get('X-Live-Expires'));
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+65_000)return new Response(null,{status:401});
    if(this.ctx.getWebSockets().length>=8)return new Response(null,{status:429});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server!);
    server!.serializeAttachment({expiresAt});
    const saved=await this.ctx.storage.get<{sequence:number}>('cursor');
    server!.send(JSON.stringify({type:'ready',sequence:saved?.sequence??0}));
    const next=await this.ctx.storage.getAlarm();
    if(next===null||next>expiresAt)await this.ctx.storage.setAlarm(expiresAt);
    return new Response(null,{status:101,webSocket:client!,headers:{'Sec-WebSocket-Protocol':'kampusone-live'}});
  }
  async alarm() {
    let next=Infinity;
    for(const socket of this.ctx.getWebSockets()) {
      const lease=socket.deserializeAttachment() as {expiresAt:number};
      if(!lease||lease.expiresAt<=Date.now())socket.close(4001,'Authorization lease expired');
      else next=Math.min(next,lease.expiresAt);
    }
    if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);
  }
  webSocketMessage(socket:WebSocket) { socket.close(1008,'This stream accepts no client data'); }
  webSocketError(socket:WebSocket) { socket.close(1011,'Reconnect to reconcile'); }
  webSocketClose(socket:WebSocket) { socket.close(); }
}
