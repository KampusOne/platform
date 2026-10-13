import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UNIBEN_UGBOWO_FALLBACK} from '../mobile/src/lib/campus-data.ts';
const source=JSON.parse(readFileSync(new URL('../database/imports/uniben-map2-2026-10-06.json',import.meta.url),'utf8'));
const corrections=JSON.parse(readFileSync(new URL('../database/imports/uniben-ground-truth-corrections-2026-10-07.json',import.meta.url),'utf8'));
const referencePois=JSON.parse(readFileSync(new URL('../database/imports/uniben-reference-pois-2026-10-09.json',import.meta.url),'utf8'));
const latestReview=JSON.parse(readFileSync(new URL('../database/imports/uniben-map-review-2026-10-13.json',import.meta.url),'utf8'));
const fieldReview=JSON.parse(readFileSync(new URL('../database/imports/uniben-field-records-review-2026-10-13.json',import.meta.url),'utf8'));
const correctionById=new Map([...corrections.places,...latestReview.corrections,...fieldReview.corrections].map(place=>[place.id,place]));
const correctedDirectory=source.directory.map(place=>{const correction=correctionById.get(place.id);return correction?{...place,latitude:correction.latitude,longitude:correction.longitude,verified_at:null}:place;});

test('both reference archives are fully indexed and GST stays in the owner-reported west field cluster',()=>{
  assert.equal(latestReview.framesReviewed.length,78);
  assert.equal(latestReview.framesReviewed.filter(frame=>frame.archive==='Map.zip').length,34);
  assert.equal(latestReview.framesReviewed.filter(frame=>frame.archive==='Map 2.zip').length,44);
  for(const frame of latestReview.framesReviewed)assert.match(frame.sha256,/^[a-f0-9]{64}$/);
  for(const expected of latestReview.corrections){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(place=>place.id===expected.id);
    assert.ok(actual,expected.name);assert.equal(Number(actual.latitude),expected.latitude);assert.equal(Number(actual.longitude),expected.longitude);assert.equal(actual.verified_at,null);
  }
  const gst=UNIBEN_UGBOWO_FALLBACK.find(place=>place.name==='GST building');
  const env=UNIBEN_UGBOWO_FALLBACK.find(place=>place.name==='Faculty of Environmental Sciences');
  const shop=UNIBEN_UGBOWO_FALLBACK.find(place=>place.name==='UNIBEN Book Shop');
  assert.ok(Number(gst.latitude)>Number(env.latitude)&&Number(gst.latitude)>Number(shop.latitude));
  assert.ok(Number(gst.longitude)<Number(shop.longitude));
  assert.ok(gst.search_aliases.includes('General Studies'));
  assert.ok(Number(env.longitude)<5.6199,'Environmental Sciences must be west of Uniben Road');
});

test('all 44 source images have individual review provenance and unresolved labels stay out',()=>{
  assert.equal(source.images.length,44);
  assert.equal(new Set(source.images.map(i=>i.image)).size,44);
  for(const image of source.images){assert.equal(image.reviewed,true);assert.match(image.sha256,/^[a-f0-9]{64}$/);assert.ok(image.observations.length>20);}
  assert.ok(source.pendingConfirmation.some(p=>p.label==='MTN LB-Net Library'));
  assert.ok(!source.directory.some(p=>p.name==='MTN LB-Net Library'));
});

test('offline places retain reviewed live IDs and actual verification timestamps',()=>{
  assert.equal(UNIBEN_UGBOWO_FALLBACK.length,181);
  assert.equal(new Set(UNIBEN_UGBOWO_FALLBACK.map(p=>p.id)).size,181);
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


test('reference POIs preserve the user screenshot bank-axis landmarks without claiming surveyed entrances',()=>{
  assert.equal(referencePois.places.length,3);
  for(const expected of referencePois.places){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(place=>place.id===expected.id);
    assert.ok(actual,expected.name);
    assert.equal(Number(actual.latitude),expected.latitude);
    assert.equal(Number(actual.longitude),expected.longitude);
    assert.equal(actual.verified_at,null);
  }
  assert.deepEqual(referencePois.places.map(place=>place.plusCode).sort(),['CJ26+X53','CJ36+69F','CJ36+72G']);
});

test('ground-truth correction removes the stale sports pin and moves banks into the reported bank block',()=>{
  assert.equal(corrections.places.length,7);
  for(const correction of corrections.places){
    const expected=correctionById.get(correction.id);
    const actual=UNIBEN_UGBOWO_FALLBACK.find(place=>place.id===correction.id);
    assert.ok(actual,correction.name);
    assert.equal(Number(actual.latitude),expected.latitude);
    assert.equal(Number(actual.longitude),expected.longitude);
    assert.equal(actual.verified_at,null);
  }
  const sports=UNIBEN_UGBOWO_FALLBACK.find(place=>place.name==='UNIBEN Sports Complex');
  const bowl=UNIBEN_UGBOWO_FALLBACK.find(place=>place.search_aliases.includes('Main Bowl'));
  assert.ok(sports&&bowl);
  assert.ok(Math.abs(Number(sports.latitude)-Number(bowl.latitude))<0.0005);
  assert.ok(Math.abs(Number(sports.longitude)-Number(bowl.longitude))<0.0005);
  const banks=corrections.places.filter(place=>/Bank/.test(place.name));
  assert.equal(banks.length,6);
  for(const bank of banks){
    assert.ok(bank.latitude>=6.4020&&bank.latitude<=6.4026,bank.name+' latitude should stay inside the reported bank block');
    assert.ok(bank.longitude>=5.6095&&bank.longitude<=5.6107,bank.name+' longitude should stay inside the reported bank block');
  }
});

test('field labels and office move together while stable IDs and old field search names survive',()=>{
  assert.equal(fieldReview.references.length,4);
  for(const ref of fieldReview.references)assert.match(ref.sha256,/^[a-f0-9]{64}$/);
  for(const expected of fieldReview.corrections){
    const actual=UNIBEN_UGBOWO_FALLBACK.find(place=>place.id===expected.id);
    assert.ok(actual);assert.equal(actual.name,expected.name);assert.equal(actual.category,expected.category);
    assert.equal(Number(actual.latitude),expected.latitude);assert.equal(Number(actual.longitude),expected.longitude);
    assert.deepEqual(actual.search_aliases,expected.search_aliases);assert.equal(actual.verified_at,null);
  }
  const field=UNIBEN_UGBOWO_FALLBACK.find(p=>p.search_aliases.includes('Football Field'));
  const exams=UNIBEN_UGBOWO_FALLBACK.find(p=>p.name==='Exams and Records');
  const sports=UNIBEN_UGBOWO_FALLBACK.find(p=>p.name==='UNIBEN Sports Complex');
  assert.ok(field.search_aliases.includes('Main Bowl'));
  assert.ok(Number(exams.longitude)-Number(field.longitude)>0.0015,'Office must leave the field for the marked building cluster');
  assert.ok(Number(sports.longitude)<5.6122,'Sports Complex must leave the auditorium junction');
});
