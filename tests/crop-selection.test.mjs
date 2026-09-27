import test from 'node:test';
import assert from 'node:assert/strict';
import {initialCrop,moveCrop,resizeCrop,sourceCrop} from '../mobile/src/lib/crop-selection.ts';
test('initial Original frame covers the complete image; avatar and cover retain the correct ratio',()=>{
  assert.deepEqual(initialCrop(300,200,1.5),{x:0,y:0,width:300,height:200});
  for(const aspect of [1,3,4/5,16/9]){const box=initialCrop(311,415,aspect);assert.ok(Math.abs(box.width/box.height-aspect)<1e-8);assert.ok(box.x>=0&&box.y>=0);}
});
test('every handle remains inside the image through extreme drag, while preserving the chosen ratio',()=>{
  for(const aspect of [1,3,4/5,16/9])for(const corner of ['tl','tr','bl','br'])for(const dx of [-1e5,-70,0,45,1e5])for(const dy of [-1e5,0,80,1e5]){
    const box=resizeCrop(initialCrop(311,415,aspect),dx,dy,corner,311,415);
    assert.ok(box.x>=-1e-8&&box.y>=-1e-8&&box.x+box.width<=311+1e-8&&box.y+box.height<=415+1e-8);
    assert.ok(box.width>0&&box.height>0&&Math.abs(box.width/box.height-aspect)<1e-8);
    const moved=moveCrop(box,dx,dy,311,415),source=sourceCrop(moved,311/1599,1599,2135);
    assert.ok(source.originX+source.width<=1599&&source.originY+source.height<=2135);
  }
});
test('preview coordinates map to the exact exported source crop',()=>{
  assert.deepEqual(sourceCrop({x:25,y:50,width:100,height:200},0.25,1200,1600),{originX:100,originY:200,width:400,height:800});
});
