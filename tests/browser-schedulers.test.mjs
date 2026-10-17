import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';

function browserModule(name) {
 const exports={},pending=new Set();let next=0,scheduled=0,cancelled=0;
 // Browser timers reject a receiver belonging to a coordinator instance.
 // Node timers accept it, so earlier injected-clock tests missed this contract.
 function setTimeout(callback,delay) { assert.equal(this,undefined,'Browser timer called with an instance receiver');assert.equal(typeof callback,'function');assert.ok(delay>=0);scheduled++;pending.add(++next);return next; }
 function clearTimeout(id) { assert.equal(this,undefined,'Browser timer cancelled with an instance receiver');cancelled++;pending.delete(id); }
 runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},require:module=>{if(module==='./request-policy')return{matchesRead:(path,prefix)=>path.startsWith(prefix)};throw Error('Unexpected module '+module);},setTimeout,clearTimeout,AbortController,URL,Date,Error});
 return{exports,pending,scheduled:()=>scheduled,cancelled:()=>cancelled};
}
test('foreground measurement can schedule and stop with browser-native timer binding',()=>{
 const h=browserModule('foreground-usage'),sampler=new h.exports.ForegroundUsageSampler(()=>{});sampler.setForeground(true);assert.equal(h.scheduled(),1);sampler.stop();assert.equal(h.pending.size,0);assert.equal(h.cancelled(),1);
});
test('read reconciliation can subscribe and unsubscribe with browser-native timer binding',()=>{
 const h=browserModule('read-coordinator'),coordinator=new h.exports.ReadCoordinator(()=>{});const unsubscribe=coordinator.subscribe('/v1/student/store',()=>{});assert.equal(h.scheduled(),1);unsubscribe();coordinator.reset();assert.equal(h.pending.size,0);
});
test('message retry can activate and stop with browser-native timer binding',()=>{
 const h=browserModule('text-retry-coordinator'),coordinator=new h.exports.TextRetryCoordinator(async()=>[],async()=>{},async()=>{},async()=>{});coordinator.setAvailable(true);assert.equal(h.scheduled(),1);coordinator.stop();assert.equal(h.pending.size,0);
});
test('a failed live ticket can back off and stop with browser-native timer binding',async()=>{
 const h=browserModule('live-connection'),connection=new h.exports.LiveConnection(async()=>{throw Error('Offline');},()=>{throw Error('Must not connect');},()=>{},()=>{},()=>{});connection.setAvailable(true);for(let n=0;n<8;n++)await Promise.resolve();assert.equal(h.scheduled(),1);connection.stop();assert.equal(h.pending.size,0);
});
