import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UNIBEN_UGBOWO_FALLBACK} from '../mobile/src/lib/campus-data.ts';
const source=JSON.parse(readFileSync(new URL('../database/imports/uniben-map2-2026-10-06.json',import.meta.url),'utf8'));

test('all 44 source images have individual review provenance and unresolved labels stay out',()=>{
  assert.equal(source.images.length,44);
  assert.equal(new Set(source.images.map(i=>i.image)).size,44);
  for(const image of source.images){assert.equal(image.reviewed,true);assert.match(image.sha256,/^[a-f0-9]{64}$/);assert.ok(image.observations.length>20);}
  assert.ok(source.pendingConfirmation.some(p=>p.label==='MTN LB-Net Library'));
  assert.ok(!source.directory.some(p=>p.name==='MTN LB-Net Library'));
});

test('offline places retain reviewed live IDs and actual verification timestamps',()=>{
  assert.equal(UNIBEN_UGBOWO_FALLBACK.length,177);
  assert.equal(new Set(UNIBEN_UGBOWO_FALLBACK.map(p=>p.id)).size,177);
  for(const expected of source.directory){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(p=>p.id===expected.id);
    assert.ok(actual,expected.name);
    assert.equal(Number(actual.latitude),Number(expected.latitude));
    assert.equal(Number(actual.longitude),Number(expected.longitude));
    assert.equal(actual.verified_at,expected.verified_at);
  }
  for(const patch of source.patches.filter(p=>p.action==='insert'||p.action==='update'))
    assert.equal(UNIBEN_UGBOWO_FALLBACK.find(p=>p.id===patch.id).verified_at,null);
});
