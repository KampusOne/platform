import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UNIBEN_UGBOWO_FALLBACK} from '../mobile/src/lib/campus-data.ts';
const source=JSON.parse(readFileSync(new URL('../database/imports/uniben-map2-2026-10-06.json',import.meta.url),'utf8'));
const corrections=JSON.parse(readFileSync(new URL('../database/imports/uniben-ground-truth-corrections-2026-10-07.json',import.meta.url),'utf8'));
const correctionById=new Map(corrections.places.map(place=>[place.id,place]));
const correctedDirectory=source.directory.map(place=>{const correction=correctionById.get(place.id);return correction?{...place,latitude:correction.latitude,longitude:correction.longitude,verified_at:null}:place;});

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
  for(const expected of correctedDirectory){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(p=>p.id===expected.id);
    assert.ok(actual,expected.name);
    assert.equal(Number(actual.latitude),Number(expected.latitude));
    assert.equal(Number(actual.longitude),Number(expected.longitude));
    assert.equal(actual.verified_at,expected.verified_at);
  }
  for(const patch of source.patches.filter(p=>p.action==='insert'||p.action==='update'))
    assert.equal(UNIBEN_UGBOWO_FALLBACK.find(p=>p.id===patch.id).verified_at,null);
});


test('ground-truth correction removes the stale sports pin and moves banks into the reported bank block',()=>{
  assert.equal(corrections.places.length,7);
  for(const correction of corrections.places){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(place=>place.id===correction.id);
    assert.ok(actual,correction.name);
    assert.equal(Number(actual.latitude),correction.latitude);
    assert.equal(Number(actual.longitude),correction.longitude);
    assert.equal(actual.verified_at,null);
  }
  const sports=corrections.places.find(place=>place.name==='UNIBEN Sports Complex');
  const bowl=UNIBEN_UGBOWO_FALLBACK.find(place=>place.name==='Main Bowl');
  assert.ok(sports&&bowl);
  assert.equal(sports.latitude,Number(bowl.latitude));
  assert.equal(sports.longitude,Number(bowl.longitude));
  const banks=corrections.places.filter(place=>/Bank/.test(place.name));
  assert.equal(banks.length,6);
  for(const bank of banks){
    assert.ok(bank.latitude>=6.4020&&bank.latitude<=6.4026,bank.name+' latitude should stay inside the reported bank block');
    assert.ok(bank.longitude>=5.6095&&bank.longitude<=5.6107,bank.name+' longitude should stay inside the reported bank block');
  }
});
