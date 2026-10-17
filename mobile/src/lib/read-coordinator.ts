import { matchesRead } from './request-policy';
type Listener = { path: string; refresh: () => Promise<unknown> | unknown; interval: number; due: number; failures: number; running: boolean; dirty: boolean };
/** One lifecycle-aware reconciliation scheduler, shared by focused screens and trusted events. */
export class ReadCoordinator {
  private rows = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;
  private online = true;
  private epoch = 0;
  private realtime = false;
  setRealtime(value:boolean){if(value===this.realtime)return;this.realtime=value;for(const row of this.rows)if(!row.running)row.due=this.now()+Math.min(300_000,row.interval*(value?5:1));this.plan();}
  reconcile(){this.event([...new Set([...this.rows].map(row=>row.path))]);}
  constructor(private invalidate: (prefixes: readonly string[]) => void, private now = Date.now,
    private schedule = (callback:()=>void,delay:number)=>setTimeout(callback,delay), private cancel = (timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer), private random = Math.random) {}
  subscribe(path: string, refresh: Listener['refresh'], interval = 60_000) {
    const bounded=Math.max(30_000,interval);
    const row: Listener = { path, refresh, interval:bounded, due:this.now()+Math.min(300_000,bounded*(this.realtime?5:1)),failures:0,running:false,dirty:false };
    this.rows.add(row); this.plan();
    return () => { this.rows.delete(row); this.plan(); };
  }
  setAvailable(active: boolean, online: boolean) {
    const resumed = (!this.active || !this.online) && active && online;
    this.active=active;this.online=online;
    if (resumed) for (const row of this.rows) row.due = this.now();
    this.plan();
  }
  event(prefixes: readonly string[]) {
    this.invalidate(prefixes);
    for (const row of this.rows) if(prefixes.some(prefix=>matchesRead(row.path,prefix))) {
      if (row.running) row.dirty=true; else row.due=this.now();
    }
    this.plan();
  }
  reset() { this.epoch++; this.rows.clear(); if(this.timer)this.cancel(this.timer);this.timer=undefined; }
  private plan() {
    if(this.timer)this.cancel(this.timer);this.timer=undefined;
    if(!this.active||!this.online)return;
    const due=[...this.rows].filter(r=>!r.running).map(r=>r.due);
    if(!due.length)return;
    this.timer=this.schedule(()=>{this.timer=undefined;void this.tick();},Math.max(0,Math.min(...due)-this.now()));
  }
  private async tick() {
    if(!this.active||!this.online)return;
    const rows=[...this.rows].filter(r=>!r.running&&r.due<=this.now());
    const epoch=this.epoch;
    // All callbacks for a resource enter the transport in the same turn and share its in-flight read.
    this.invalidate([...new Set(rows.map(r=>r.path))]);
    await Promise.all(rows.map(async row=>{
      row.running=true;
      try { await row.refresh();row.failures=0; }
      catch { row.failures=Math.min(row.failures+1,4); }
      finally {
        if(this.epoch!==epoch||!this.rows.has(row))return;
        row.running=false;
        row.due=row.dirty?this.now():this.now()+Math.min(300_000,row.interval*(this.realtime?5:1)*2**row.failures*(0.9+this.random()*0.2));
        row.dirty=false;
      }
    }));
    this.plan();
  }
}
