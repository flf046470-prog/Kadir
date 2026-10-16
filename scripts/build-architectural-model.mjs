/** SkySphere architectural visualization. All dimensions are design assumptions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { createCanvas, loadImage, ImageData, Canvas, Image } from '@napi-rs/canvas';

const root=path.resolve('public/immersive');const low=process.argv.includes('--low');
globalThis.ImageData=ImageData; globalThis.HTMLCanvasElement=Canvas; globalThis.HTMLImageElement=Image;
globalThis.document={createElement:()=>{const c=createCanvas(1,1);c.toBlob=(fn,mime='image/png')=>fn(new Blob([c.toBuffer(mime)]));return c;}};
globalThis.FileReader=class {readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
const group=new T.Group();group.name='SkySphere — Architectural Concept';group.userData={status:'Unbuilt architectural visualization',dimensions:'Concept assumptions, not survey or construction dimensions',unit:'metre'};
const mats={};
async function textured(name,slug,color,repeat=1,roughness=.8){
 const images=await Promise.all(['Diffuse','nor_gl','arm'].map(async kind=>{
  const image=await loadImage(path.join(root,'materials',`${slug}-${kind}.jpg`));const c=createCanvas(512,512);c.getContext('2d').drawImage(image,0,0,512,512);
  const tex=new T.CanvasTexture(c);tex.flipY=false;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(repeat,repeat);tex.userData.mimeType='image/jpeg';if(kind==='Diffuse')tex.colorSpace=T.SRGBColorSpace;return tex;
 }));
 const m=new T.MeshStandardMaterial({name,color,map:images[0],normalMap:images[1],normalScale:new T.Vector2(.45,.45),roughnessMap:images[2],roughness,metalness:0});mats[name]=m;return m;
}
const wood=await textured('Warm timber','wood_floor_deck','#c8ac88',1.3,.72);
const floorWood=await textured('Timber flooring','wood_floor_deck','#d9c3a1',9,.68);
const stone=await textured('Natural stone','rock_face','#c4baa2',3,.95);
const roofGrass=await textured('Living roof','grass_ground','#9da36b',6,1);
const fabric=await textured('Woven linen','rough_linen','#e4d5bb',2.5,.96);
const standard=(name,color,roughness=.6,metalness=0,extra={})=>(mats[name]=new T.MeshStandardMaterial({name,color,roughness,metalness,...extra}));
const cream=standard('Warm plaster','#c6bda9',.9),dark=standard('Bronze frames','#4f493d',.35,.8),white=standard('Porcelain','#e9e5d9',.17),black=standard('Kitchen stone','#34372f',.28,.1),brass=standard('Brushed brass','#bfa477',.3,.85),green=standard('Olive foliage','#566944',.95),rug=standard('Wool rug','#93897a',1),_water=standard('Courtyard basin','#314f4b',.13,.35),light=standard('Warm light','#ffe7be',.45,0,{emissive:'#ffc985',emissiveIntensity:1.5});
const glass=new T.MeshPhysicalMaterial({name:'Architectural glazing',color:'#c0d7d5',roughness:.055,metalness:0,transmission:.68,thickness:.035,ior:1.45,transparent:true,opacity:.42,side:T.DoubleSide});mats.Glass=glass;
const collision=[];
function mesh(name,g,m,x=0,y=0,z=0){const o=new T.Mesh(g,m);o.name=name;o.position.set(x,y,z);o.castShadow=m!==glass;o.receiveShadow=true;group.add(o);return o;}
function box(name,x,y,z,w,h,d,m,round=.035,block=false){const o=mesh(name,new RoundedBoxGeometry(w,h,d,1,Math.min(round,w/3,h/3,d/3)),m,x,y,z);if(block)collision.push({x,z,w,d});return o;}
function cyl(name,x,y,z,r,h,m,segments=40){return mesh(name,new T.CylinderGeometry(r,r,h,low?Math.min(segments,16):segments),m,x,y,z);}
function ball(name,x,y,z,sx,sy,sz,m){const o=mesh(name,new T.SphereGeometry(1,low?8:12,low?5:8),m,x,y,z);o.scale.set(sx,sy,sz);return o;}
function beam(name,a,b,r,m){const d=new T.Vector3(...b).sub(new T.Vector3(...a));const o=mesh(name,new T.CylinderGeometry(r,r,d.length(),8),m,...new T.Vector3(...a).addScaledVector(d,.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;}
function ring(name,r,t,y,m){const o=mesh(name,new T.TorusGeometry(r,t,8,96),m,0,y,0);o.rotation.x=Math.PI/2;return o;}
function wall(x,z,w,d){box('Interior partition',x,1.66,z,w,3.12,d,cream,.02,true);box('Timber skirting',x,.23,z,w+.02,.11,d+.02,wood,.008);}
function legs(x,z,w,d,h,m=wood){for(const dx of [-1,1])for(const dz of [-1,1])box('Furniture leg',x+dx*w*.4,h/2+.12,z+dz*d*.4,.07,h,.07,m,.01);}
function chair(x,z,angle){collision.push({x,z,w:.65,d:.65});const pivot=new T.Group();const before=group.children.length;box('Chair seat',x,.59,z,.54,.14,.54,fabric,.07);box('Chair back',x,.98,z-.24,.55,.64,.1,fabric,.07);legs(x,z,.52,.52,.41);const children=group.children.slice(before);for(const o of children){group.remove(o);o.position.sub(new T.Vector3(x,0,z));pivot.add(o);}pivot.position.set(x,0,z);pivot.rotation.y=angle;group.add(pivot);}

// Circular plan, roof annulus, glazed facade and central dome.
cyl('Foundation',0,-.1,0,9.65,.35,stone,96);cyl('Interior floor',0,.11,0,9.35,.18,floorWood,96);
const back=mesh('Earth sheltered retaining wall',new T.CylinderGeometry(9.37,9.37,3.15,96,1,true,1.28,Math.PI*2-2.56),stone,0,1.75,0);back.material=stone.clone();back.material.side=T.DoubleSide;
for(const y of [.22,3.13]){const o=mesh('Circular timber band',new T.CylinderGeometry(9.34,9.34,.13,96,1,true),wood,0,y,0);o.material=wood.clone();o.material.side=T.DoubleSide;}
for(let i=0;i<18;i++){const a=-1.28+i*(2.56/18),b=a+2.56/18,mid=(a+b)/2;if(Math.abs(mid)>.12){const panel=mesh('Panoramic window',new T.PlaneGeometry(2*9.31*Math.sin((b-a)/2),2.9),glass,Math.sin(mid)*9.31,1.68,Math.cos(mid)*9.31);panel.rotation.y=mid;}box('Window mullion',Math.sin(a)*9.32,1.68,Math.cos(a)*9.32,.055,3.08,.055,dark,.008);}
box('Entry door lintel',0,3.08,9.29,2.4,.1,.12,dark,.01);
const door=box('Open entry door',-.95,1.65,9.7,1.03,2.84,.045,glass,.005);door.rotation.y=-1.18;box('Door handle',-.49,1.25,9.55,.035,.38,.045,brass,.01);
for(const [y,m] of [[3.21,wood],[3.44,roofGrass]]){const o=mesh('Green roof annulus',new T.RingGeometry(3.15,9.8,96),m,0,y,0);o.rotation.x=-Math.PI/2;o.material=m.clone();o.material.side=T.DoubleSide;}
ring('Roof edge',9.77,.15,3.29,stone);ring('Dome base',3.16,.065,3.38,dark);
const dome=mesh('Central glass dome',new T.SphereGeometry(3.15,48,20,0,Math.PI*2,0,Math.PI/2),glass,0,3.4,0);dome.scale.y=.58;
for(let i=0;i<16;i++){const a=i*Math.PI/8;const pts=[];for(let j=0;j<=18;j++){const p=j/18*Math.PI/2;pts.push(new T.Vector3(Math.sin(a)*Math.cos(p)*3.17,3.4+Math.sin(p)*1.84,Math.cos(a)*Math.cos(p)*3.17));}mesh('Dome rib',new T.TubeGeometry(new T.CatmullRomCurve3(pts),20,.025,6,false),dark);const x=Math.sin(a),z=Math.cos(a);beam('Radial timber ceiling beam',[x*3.18,3.12,z*3.18],[x*9.34,3.12,z*9.34],.075,wood);}
ring('Dome crown',.45,.025,5.21,dark);
const terrace=mesh('Exterior terrace',new T.CylinderGeometry(12.7,12.7,.22,72,1,false,-1.12,2.24),wood,0,.06,0);
terrace.name='Timber terrace';

// Door openings remain unobstructed; all dimensions are conceptual assumptions.
wall(2.8,-5.8,.18,5.8);wall(2.8,-.85,.18,1.1);wall(-3.3,-6.35,.18,4.4);wall(-6.3,-3.95,3.4,.18);
box('Bedroom doorway lintel',2.8,2.88,-2.35,.2,.55,1.45,wood,.02);

// Living space: linen sectional, rug, oak tables, books and lamp.
const carpet=mesh('Living rug',new T.CircleGeometry(2.6,64),rug,4.3,.213,3.9);carpet.rotation.x=-Math.PI/2;
box('Sofa base',5.6,.46,3.4,3.25,.47,1.03,wood,.08,true);box('Sofa back',5.6,.96,3,3.25,.67,.24,fabric,.12);
for(let i=0;i<3;i++){box('Sofa cushion',4.58+i*1.03,.76,3.48,.98,.3,.85,fabric,.14);box('Loose cushion',4.65+i*1.02,1.05,3.22,.73,.6,.19,fabric,.12);}
box('Chaise',6.72,.62,4.4,1.0,.65,1.8,fabric,.14,true);cyl('Coffee table',4.4,.57,4.85,.9,.12,wood);cyl('Coffee table base',4.4,.35,4.85,.29,.43,dark);box('Art book',4.18,.67,4.7,.42,.07,.32,cream,.008);cyl('Ceramic vase',4.65,.83,4.92,.12,.38,white);
beam('Floor lamp stem',[7.1,.2,2.4],[7.1,1.8,2.4],.018,brass);cyl('Lamp base',7.1,.23,2.4,.23,.05,dark);mesh('Lamp shade',new T.ConeGeometry(.32,.38,28,1,true),fabric,7.1,1.72,2.4);ball('Lamp glow',7.1,1.62,2.4,.07,.06,.07,light);

// Kitchen cabinetry and an island with stools.
box('Kitchen cabinet run',-6.9,.65,-1.4,1.0,1.04,4.2,wood,.025,true);box('Stone countertop',-6.86,1.21,-1.4,1.12,.09,4.35,black,.025);
for(let i=0;i<5;i++){box('Cabinet door',-6.31,.68,-3.0+i*.78,.045,.87,.72,wood,.018);box('Cabinet handle',-6.265,.87,-3+i*.78,.035,.04,.3,brass,.012);}
box('Kitchen island',-4.8,.65,0,2.1,1.05,.95,wood,.035,true);box('Island stone top',-4.8,1.23,0,2.25,.09,1.06,black,.03);
box('Sink',-6.83,1.265,-2.5,.76,.025,.66,dark,.07);beam('Tap riser',[-6.95,1.28,-2.88],[-6.95,1.65,-2.88],.022,brass);beam('Tap spout',[-6.95,1.65,-2.88],[-6.76,1.65,-2.7],.022,brass);
box('Induction hob',-6.8,1.27,-.25,.78,.025,1.08,black,.025);for(const z of [-.55,.1])for(const x of [-6.99,-6.64]){const o=mesh('Hob ring',new T.TorusGeometry(.13,.009,5,24),dark,x,1.29,z);o.rotation.x=Math.PI/2;}
for(const x of [-5.35,-4.4]){cyl('Stool seat',x,.86,1.05,.27,.09,fabric);legs(x,1.05,.4,.4,.67,dark);}
box('Refrigerator',-6.2,1.37,-4.25,1.0,2.45,.72,dark,.025,true);box('Fridge handle',-5.78,1.5,-3.85,.035,.55,.04,brass,.01);

// Dining.
const _table=ball('Oak dining table',-4.3,.95,4.5,1.45,.1,.78,wood);legs(-4.3,4.5,2.55,1.2,.76);collision.push({x:-4.3,z:4.5,w:2.8,d:1.45});
for(const x of [-5.1,-3.55]){chair(x,3.35,0);chair(x,5.63,Math.PI);}chair(-6.05,4.5,Math.PI/2);chair(-2.58,4.5,-Math.PI/2);cyl('Dining vase',-4.3,1.1,4.5,.15,.25,white);

// Bedroom.
box('Bedroom rug',5.6,.21,-5.1,4.4,.025,4.0,rug,.01);box('Bed frame',5.5,.46,-5.6,2.15,.45,2.45,wood,.07,true);box('Mattress',5.5,.76,-5.56,2.06,.36,2.24,fabric,.13);box('Duvet',5.5,.96,-5.15,2.13,.19,1.68,fabric,.11);box('Timber headboard',5.5,1.13,-6.78,2.5,1.5,.14,wood,.06);
for(const x of [4.94,6.03])box('Bed pillow',x,1.03,-6.18,.83,.23,.57,white,.13);
for(const x of [3.9,7.1]){box('Bedside table',x,.55,-6.1,.55,.62,.58,wood,.05);cyl('Bedside light',x,.98,-6.1,.14,.21,light);}
box('Bedroom wardrobe',7.65,1.45,-2.0,1.0,2.65,2.0,wood,.02,true);for(const z of [-2.55,-1.75])box('Wardrobe handle',7.1,1.45,z,.04,.4,.04,brass,.01);

// Bath: rain shower, stone vanity, porcelain fixtures and reflective mirror.
box('Bathroom stone floor',-5.9,.22,-6.25,4.6,.035,3.9,stone,.015);box('Walk-in shower tray',-6.7,.27,-6.75,1.6,.07,1.6,white,.035,true);box('Shower screen',-5.91,1.56,-6.75,.035,2.55,1.65,glass,.005);beam('Rain shower pipe',[-6.8,.32,-7.42],[-6.8,2.6,-7.42],.025,brass);beam('Rain shower arm',[-6.8,2.6,-7.42],[-6.8,2.6,-6.94],.025,brass);cyl('Rain shower head',-6.8,2.57,-6.94,.19,.035,brass);
box('Stone vanity',-4.35,.72,-7.0,1.3,.8,.75,wood,.025,true);box('Vanity top',-4.35,1.16,-7,1.43,.12,.88,stone,.025);const bowl=mesh('Basin',new T.SphereGeometry(.3,32,16,0,Math.PI*2,Math.PI/2,Math.PI/2),white,-4.35,1.27,-6.94);bowl.scale.y=.5;cyl('Vanity tap',-4.35,1.41,-7.3,.022,.36,brass);box('Vanity mirror',-4.35,1.95,-7.42,1.15,1.22,.03,brass,.035);
ball('Toilet bowl',-7.65,.53,-4.8,.28,.28,.37,white);box('Toilet cistern',-7.65,.84,-5.05,.55,.7,.2,white,.06);cyl('Toilet pedestal',-7.65,.33,-4.9,.19,.39,white);

// Central courtyard planting under the dome.
cyl('Courtyard planter',0,.35,0,1.27,.31,stone,64);cyl('Courtyard soil',0,.51,0,1.18,.02,rug,64);collision.push({circle:true,x:0,z:0,r:2.0});
beam('Olive trunk',[0,.52,0],[.13,2.36,.07],.085,wood);for(let i=0;i<14;i++){const a=i*2.399,r=.55+(i%4)*.13,h=1.35+(i%5)*.23;beam('Olive branch',[.08,1.25,0],[Math.sin(a)*r,h,Math.cos(a)*r],.018,wood);for(let j=0;j<5;j++){const b=a+j*.55;const leaf=ball('Olive leaves',Math.sin(a)*r+Math.sin(b)*.22,h+j*.07,Math.cos(a)*r+Math.cos(b)*.22,.18,.04,.075,green);leaf.rotation.z=b;}}
for(let i=0;i<8;i++){const a=i*Math.PI/4;const o=box('Courtyard bench',Math.sin(a)*1.8,.47,Math.cos(a)*1.8,.9,.11,.37,wood,.045);o.rotation.y=a;}

// Outdoor furniture and low garden wall.
box('Terrace sofa',4,.52,10.3,2.3,.65,.88,fabric,.12,true);box('Terrace back',4,.95,10.03,2.3,.55,.18,fabric,.08);cyl('Terrace table',2.25,.56,10.7,.52,.12,wood);cyl('Terrace table foot',2.25,.32,10.7,.2,.4,dark);
for(const x of [-5.8,6.9]){cyl('Terrace planter',x,.53,9.85,.38,.8,stone);for(let i=0;i<9;i++)beam('Garden grasses',[x,.93,9.85],[x+Math.sin(i*2.4)*.25,1.25+(i%3)*.12,9.85+Math.cos(i*2.4)*.25],.014,green);}

group.updateMatrixWorld(true);
// Merge static geometry per material: fewer mobile draw calls, same PBR surfaces.
const merged=new T.Group();merged.name=group.name;merged.userData=group.userData;const buckets=new Map();group.traverse(o=>{if(!o.isMesh)return;const m=o.material;const g=o.geometry.clone().applyMatrix4(o.matrixWorld);g.deleteAttribute('uv1');g.deleteAttribute('uv2');if(!g.getAttribute('uv'))g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));const key=m.uuid;const item=buckets.get(key)??{m,geo:[]};item.geo.push(g.index?g.toNonIndexed():g);buckets.set(key,item);});
for(const {m,geo} of buckets.values()){const g=mergeGeometries(geo,false);const o=new T.Mesh(g,m);o.name=m.name;o.castShadow=m!==glass;o.receiveShadow=true;merged.add(o);}
merged.updateMatrixWorld(true);
const glb=await new GLTFExporter().parseAsync(merged,{binary:true,maxTextureSize:low?256:512,onlyVisible:true});await fs.writeFile(path.join(root,low?'skysphere-residence-mobile.glb':'skysphere-residence.glb'),Buffer.from(glb));
const usdz=low?new Uint8Array():await new USDZExporter().parseAsync(merged,{maxTextureSize:512,quickLookCompatible:true,includeAnchoringProperties:true,ar:{anchoring:{type:'plane'},planeAnchoring:{alignment:'horizontal'}}});if(!low)await fs.writeFile(path.join(root,'skysphere-residence.usdz'),Buffer.from(usdz));
const manifest={concept:true,verifiedDimensions:false,radius:9.35,floor:.21,eyeHeight:1.65,collision,rooms:[{id:'entry',position:[0,1.86,8.35],look:[0,1.6,0]},{id:'living',position:[3.2,1.86,4.1],look:[5.5,1.1,3.1]},{id:'kitchen',position:[-4.5,1.86,-1.8],look:[-6.8,1.2,-1.4]},{id:'bedroom',position:[4.2,1.86,-2.7],look:[5.5,.9,-5.7]},{id:'bathroom',position:[-4.75,1.86,-5.1],look:[-6.5,1.4,-6.6]},{id:'dome',position:[0,1.86,2.3],look:[0,4.6,0]},{id:'terrace',position:[0,1.86,11.7],look:[0,1.3,30]}]};await fs.writeFile(path.join(root,'tour-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const triangles=merged.children.reduce((n,o)=>n+o.geometry.attributes.position.count/3,0);console.log(JSON.stringify({drawCalls:merged.children.length,triangles,glb:glb.byteLength,usdz:usdz.byteLength}));
