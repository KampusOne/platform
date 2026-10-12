export type LiveTicket={ticket:string;url:string;expiresAt:number};
type Socket=Pick<WebSocket,'onopen'|'onmessage'|'onerror'|'onclose'|'close'>;
/** One foreground connection. Short tickets stay out of URLs and durable client storage. */
export class LiveConnection {
  private socket:Socket|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private abort:AbortController|null=null;
  private active=false;
  private stopped=false;
  private attempt=0;
  private epoch=0;
  private sequence=-1;
  private disabled=false;
  constructor(private ticket:(signal:AbortSignal)=>Promise<LiveTicket>,private open:(url:string,protocols:string[])=>Socket,
    private reconcile:()=>void,private change:(paths:string[])=>void,private ready:(value:boolean)=>void,
    private schedule=setTimeout,private cancel=clearTimeout,private random=Math.random){}
  setAvailable(value:boolean){
    if(value===this.active||this.stopped)return;
    this.active=value;this.epoch++;
    this.disconnect();
    if(value){this.disabled=false;this.attempt=0;void this.connect();}
  }
  stop(){this.stopped=true;this.active=false;this.epoch++;this.disconnect();}
  private disconnect(){
    if(this.timer)this.cancel(this.timer);this.timer=undefined;
    this.abort?.abort();this.abort=null;
    if(this.socket){const socket=this.socket;this.socket=null;socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();}
    this.ready(false);
  }
  private retry(epoch:number){
    if(!this.active||this.stopped||this.disabled||epoch!==this.epoch||this.timer)return;
    const delay=Math.min(30_000,1000*2**Math.min(this.attempt++,5)*(0.75+this.random()*0.5));
    this.timer=this.schedule(()=>{this.timer=undefined;void this.connect();},delay);
  }
  private async connect(){
    if(!this.active||this.stopped||this.disabled||this.socket||this.abort)return;
    const epoch=this.epoch,abort=new AbortController();this.abort=abort;
    try{
      const ticket=await this.ticket(abort.signal);
      if(abort.signal.aborted||epoch!==this.epoch)return;
      const url=new URL(ticket.url);
      if(!['wss:','ws:'].includes(url.protocol)||url.username||url.password||url.search||!ticket.ticket||ticket.ticket.length>2000||!Number.isFinite(ticket.expiresAt)||ticket.expiresAt<=Date.now())throw new Error('Invalid live ticket');
      const socket=this.open(url.toString(),['kampusone-live','ticket.'+ticket.ticket]);this.socket=socket;
      socket.onopen=()=>{if(epoch===this.epoch){this.attempt=0;if(this.timer)this.cancel(this.timer);this.timer=undefined;}};
      socket.onmessage=event=>{
        if(epoch!==this.epoch||typeof event.data!=='string'||event.data.length>4096)return;
        try{
          const data=JSON.parse(event.data);
          if(!Number.isSafeInteger(data.sequence)||data.sequence<0)return;
          if(data.type==='ready'){this.sequence=data.sequence;this.ready(true);this.reconcile();return;}
          if(data.type!=='change'||data.sequence<=this.sequence||!Array.isArray(data.prefixes)||data.prefixes.length>8||!data.prefixes.every((p:unknown)=>typeof p==='string'&&/^\/v1\/(messages\/(?:inbox|threads\/[a-f0-9-]{36})|notifications\/inbox|agents)$/.test(p)))return;
          if(this.sequence>=0&&data.sequence!==this.sequence+1)this.reconcile();
          this.sequence=data.sequence;this.change(data.prefixes);
        }catch{/* Ignore malformed or unauthorized event shapes. */}
      };
      const closed=()=>{if(this.socket!==socket)return;this.socket=null;if(this.timer)this.cancel(this.timer);this.timer=undefined;this.ready(false);socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();this.retry(epoch);};
      socket.onclose=closed;socket.onerror=closed;
      this.timer=this.schedule(()=>{this.timer=undefined;closed();},10_000);
    }catch(error){
      if(abort.signal.aborted||epoch!==this.epoch)return;
      if(error&&typeof error==='object'&&('code' in error&&error.code==='FEATURE_DISABLED'||'status' in error&&error.status===404))this.disabled=true;
      this.ready(false);this.retry(epoch);
    }finally{if(this.abort===abort)this.abort=null;}
  }
}
