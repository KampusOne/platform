import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function counts(){let owner=1;const exports={};const code=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/unread-counts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;runInNewContext(code,{exports,module:{exports},require:()=>({getDeviceCacheRevision:()=>owner}),Set,Number});return{...exports,switchAccount(){owner++;}};}
test('confirmed read counts beat an older in-flight inbox response',()=>{
  const c=counts();c.updateUnreadCount('messages',3);const before=c.unreadRead('messages');
  c.updateUnreadCount('messages',2);assert.equal(c.updateUnreadCount('messages',3,before.revision,before.version),false);assert.equal(c.unreadCount('messages'),2);
});
test('account and institution changes clear both badges and reject old reads',()=>{
  const c=counts();c.updateUnreadCount('messages',3);c.updateUnreadCount('notifications',5);const old=c.unreadRead('messages');c.switchAccount();
  assert.equal(c.unreadCount('messages'),0);assert.equal(c.unreadCount('notifications'),0);assert.equal(c.updateUnreadCount('messages',3,old.revision),false);
});
test('DM and notification counts are independent and never become negative',()=>{
  const c=counts();c.updateUnreadCount('messages',3);c.updateUnreadCount('notifications',1);c.changeUnreadCount('notifications',-5);
  assert.equal(c.unreadCount('messages'),3);assert.equal(c.unreadCount('notifications'),0);assert.equal(c.updateUnreadCount('messages',NaN),false);
});
