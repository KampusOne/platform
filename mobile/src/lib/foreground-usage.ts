export type UsageSample={id:string;ownerUserId:string;platform:string;screen:string;startedAt:string;endedAt:string;seconds:number};
export function validUsageSample(value:unknown,owner:string,now=Date.now()):value is UsageSample{
  if(!value||typeof value!=='object')return false;
  const sample=value as UsageSample,start=Date.parse(sample.startedAt),end=Date.parse(sample.endedAt);
  return sample.ownerUserId===owner&&typeof sample.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sample.id)&&['android','ios','web'].includes(sample.platform)&&typeof sample.screen==='string'&&/^[a-zA-Z0-9_\-/()\[\]]{1,100}$/.test(sample.screen)&&Number.isFinite(start)&&Number.isFinite(end)&&start>now-48*3600000&&end<=now+120000&&end>start&&end-start<=61000&&Number.isFinite(sample.seconds)&&sample.seconds>0&&sample.seconds<=60&&Math.abs((end-start)/1000-sample.seconds)<=1;
}
/** Optional foreground measurement; no recurring timer exists while inactive. */
export class ForegroundUsageSampler{
  private foreground=false;
  private stopped=false;
  private started=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(private sample:(startedAt:number,endedAt:number,seconds:number)=>void,private now=Date.now,private schedule=setTimeout,private cancel=clearTimeout){}
  setForeground(value:boolean){if(this.stopped||value===this.foreground)return;this.capture();this.foreground=value;this.started=this.now();this.plan();}
  stop(){if(this.stopped)return;this.capture();this.stopped=true;this.foreground=false;if(this.timer!==undefined)this.cancel(this.timer);this.timer=undefined;}
  private capture(){const end=this.now(),elapsed=end-this.started;this.started=end;if(!this.foreground||elapsed<500)return;const seconds=Math.min(elapsed/1000,60);this.sample(end-seconds*1000,end,seconds);}
  private plan(){if(this.timer!==undefined)this.cancel(this.timer);this.timer=undefined;if(!this.foreground||this.stopped)return;this.timer=this.schedule(()=>{this.timer=undefined;this.capture();this.plan();},30000);}
}
