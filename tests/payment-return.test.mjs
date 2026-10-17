import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {typescript as ts} from './helpers/typescript.mjs';
import * as paymentLinks from '../packages/contracts/src/payment-links.ts';
function load(file,mocks={}) {
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},require:key=>{if(key in mocks)return mocks[key];throw Error(key);},URL,Date,Number,Error});return exports;
}
const flow=load('payment-flow.ts',{'../../../packages/contracts/src/payment-links':paymentLinks}),owner='11111111-1111-4111-8111-111111111111',reference='K1-B-O-22222222-2222-4222-8222-222222222222';
function fixture(){let current=null,authorized=owner,storageFailure=false;const events=[];const lib=load('hosted-payment.ts',{'./payment-flow':flow,'./device-cache':{getDeviceCacheRevision:()=>1,isDeviceCacheOwner:id=>id===authorized,readOwnedDraft:async()=>current,saveOwnedDraft:async(key,value)=>{if(storageFailure)throw Error('Storage unavailable');events.push('saved');current=value;}},'expo-router':{router:{replace:path=>events.push(path)}},'react-native':{Linking:{openURL:async()=>events.push('opened')}}});return{lib,events,current:()=>current,fail:()=>{storageFailure=true;},switch:()=>{authorized='another-account';}};}
test('keeps the owned receipt before leaving for checkout and restores it after returning',async()=>{
 const f=fixture();await f.lib.openHostedPayment(owner,{reference,authorizationUrl:'https://checkout.bachs.io/c/synthetic'});
 assert.equal(f.events[0],'saved');assert.equal(f.events[1].pathname,'/checkout');assert.equal(f.events[1].params.reference,reference);assert.equal(f.events.length,2);assert.equal((await f.lib.pendingPayment(owner)).reference,reference);
 f.switch();assert.equal(await f.lib.pendingPayment(owner),null);
});
test('never opens checkout when the receipt cannot be safely retained',async()=>{
 const f=fixture();f.fail();await assert.rejects(f.lib.openHostedPayment(owner,{reference,authorizationUrl:'https://checkout.bachs.io/c/synthetic'}));assert.equal(f.events.length,0);
});
test('continues to the exact purchased order and dismisses only the matching pending receipt',async()=>{
 const f=fixture();await f.lib.openHostedPayment(owner,{reference,authorizationUrl:'https://checkout.bachs.io/c/synthetic'});await f.lib.dismissPayment(owner,'K1-B-O-another');assert.ok(f.current());await f.lib.dismissPayment(owner,reference);assert.equal(f.current(),null);
 const route=flow.paymentContinuation({resource_type:'STORE_ORDER',resource_id:'order-id'});assert.equal(route.pathname,'/order-detail');assert.equal(route.params.id,'order-id');
});
test('rejects malformed references and insecure checkout URLs before navigation',async()=>{
 const f=fixture();await assert.rejects(f.lib.openHostedPayment(owner,{reference:'../../settings',authorizationUrl:'https://checkout.bachs.io/c/synthetic'}));await assert.rejects(f.lib.openHostedPayment(owner,{reference,authorizationUrl:'javascript:alert(1)'}));assert.equal(f.events.length,0);
});
