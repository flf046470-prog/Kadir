import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canOccupy, slideMove, findRoute } from '../src/components/immersive/navigation.ts';
const model=JSON.parse(fs.readFileSync(new URL('../public/immersive/tour-manifest.json',import.meta.url),'utf8'));
test('walkable room viewpoints stay clear of walls and furniture',()=>{
 for(const r of model.rooms)assert.ok(canOccupy(r.position[0],r.position[2],model.collision),r.id);
});
test('every room is reachable from the entrance through door openings',()=>{
 const entry=model.rooms[0];
 for(const room of model.rooms){
  const p=findRoute({x:entry.position[0],z:entry.position[2]},{x:room.position[0],z:room.position[2]},model.collision);
  assert.ok(p.length>0,room.id);
  for(let i=1;i<p.length;i++)for(let t=0;t<=1;t+=.1)assert.ok(canOccupy(p[i-1].x+(p[i].x-p[i-1].x)*t,p[i-1].z+(p[i].z-p[i-1].z)*t,model.collision),room.id);
 }
});
test('movement cannot tunnel through partitions or panoramic glazing',()=>{
 const a=slideMove({x:2.0,z:-5},3,0,model.collision);assert.ok(a.x<2.5);
 const b=slideMove({x:5,z:6.5},0,6,model.collision);assert.ok(b.z<8);
});
test('the open entrance connects the interior and terrace',()=>{
 assert.ok(findRoute({x:0,z:8},{x:0,z:11.7},model.collision).length>0);
});
