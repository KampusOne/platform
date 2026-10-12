import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const {build}=require('esbuild');
const WebSocket=require('ws');
const source=`
import {LiveUser} from './src/lib/live-updates';
export class TestHub extends LiveUser {
  async fetch(request){
    if(new URL(request.url).pathname==='/status')return Response.json({connections:this.ctx.getWebSockets().length,alarm:await this.ctx.storage.getAlarm()});
    return super.fetch(request);
  }
}
export default {async fetch(request,env){
  const stub=env.LIVE_USERS.get(env.LIVE_USERS.idFromName('synthetic-runtime-scope'));
  const path=new URL(request.url).pathname;
  if(path==='/ws')return stub.fetch('https://internal/connect',{headers:{Upgrade:'websocket','X-Live-Expires':String(Date.now()+2500)}});
  if(path==='/event')return stub.fetch('https://internal/change',{method:'POST',body:JSON.stringify({id:'synthetic-one',prefixes:['/v1/messages/inbox']})});
  if(path==='/status')return stub.fetch('https://internal/status');
  return new Response(null,{status:404});
}};`;
const bundled=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'synthetic-runtime-test.js'},bundle:true,format:'esm',platform:'browser',write:false});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-09',durableObjects:{LIVE_USERS:{className:'TestHub',useSQLite:true}},durableObjectsPersist:false}));
let socket;
try{
  const base=await runtime.ready;
  // Short client close acknowledgement timeout keeps the synthetic test bounded.
  socket=new WebSocket(new URL('/ws',base).toString().replace(/^http/,'ws'),['kampusone-live'],{closeTimeout:250});
  const events=[];let closeCode;
  socket.on('message',value=>events.push(JSON.parse(value.toString())));
  socket.on('close',code=>{closeCode=code;});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  await runtime.dispatchFetch('https://synthetic.invalid/event',{method:'POST'});
  await runtime.dispatchFetch('https://synthetic.invalid/event',{method:'POST'});
  await new Promise(resolve=>setTimeout(resolve,4000));
  assert.equal(events.filter(event=>event.type==='ready').length,1);
  assert.deepEqual(events.filter(event=>event.type==='change'),[{type:'change',sequence:1,prefixes:['/v1/messages/inbox']}]);
  assert.equal(closeCode,4001);
  const status=await (await runtime.dispatchFetch('https://synthetic.invalid/status')).json();
  assert.deepEqual(status,{connections:0,alarm:null});
  console.log('PASS: local workerd upgrade, ordered event, duplicate suppression, lease alarm and socket cleanup. No deployment or provider calls.');
}finally{socket?.terminate();await runtime.dispose();}
