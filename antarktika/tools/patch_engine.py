"""One-time patch of Game/index.html: hooks the A3D asset layer, save system,
three quality levels and analog touch input into the original ICEWALK engine.
Every replacement is asserted to match exactly once."""
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit("expected %d match(es), found %d for:\n%s" % (count, n, old[:200]))
    s = s.replace(old, new)


# ---------------------------------------------------------------- head / viewport
rep('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">')
rep(':root{--ice:#d7f4ff;', 'html,body{-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}:root{--ice:#d7f4ff;')

# ---------------------------------------------------------------- prologue: relocate + save
rep("return {begin,selectSkip,useSkip,goal,distance,act,drawUI,mainUI,instruction,summary,get active(){return active;},get completed(){return completed;}};",
    "return {begin,selectSkip,useSkip,goal,distance,act,drawUI,mainUI,instruction,summary,"
    "relocate(i,x,z,r){if(steps[i]){steps[i].x=x;steps[i].z=z;if(r)steps[i].radius=r;}},"
    "serialize(){return {active,stage,completed};},"
    "restore(o){if(!o)return;active=!!o.active;stage=o.stage|0;completed=!!o.completed;document.body.classList.toggle('prologue-live',active);$('skipPrologue').hidden=true;},"
    "get active(){return active;},get completed(){return completed;}};")

# ---------------------------------------------------------------- journal save
rep("show(){root.classList.add('open');document.getElementById('journalClose').focus();},",
    "serialize(){return {found:[...found],inventory:inventory.textContent,entries:[...entries.querySelectorAll('article')].map(a=>[a.querySelector('h3')?.textContent||'',a.querySelector('p')?.textContent||''])};},"
    "restore(o){if(!o)return;found=[...(o.found||[])];entries.replaceChildren();for(const [t,b] of o.entries||[]){const a=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=t;p.textContent=b;a.append(h,p);entries.append(a);}if(o.inventory)inventory.textContent=o.inventory;},"
    "show(){root.classList.add('open');document.getElementById('journalClose').focus();},")

# ---------------------------------------------------------------- field scanner save
rep("return {sites,reset,setVisible,ping,update,collect,craft,drawMarkers,pressure,get insulated(){return insulated;},",
    "return {sites,reset,setVisible,ping,update,collect,craft,drawMarkers,pressure,"
    "serialize(){return {known:[...known],taken:[...taken],shards,insulated};},"
    "restore(o){if(!o)return;known.clear();taken.clear();(o.known||[]).forEach(k=>known.add(k));(o.taken||[]).forEach(k=>taken.add(k));shards=o.shards|0;insulated=!!o.insulated;inventoryUpdate();},"
    "get insulated(){return insulated;},")

# ---------------------------------------------------------------- cargo save
rep("return {sites,shelter,reset,setVisible,scan,interact,update,drawMarkers,diagnostics,get heatBonus(){return stage>=2?.16:0;}};",
    "return {sites,shelter,reset,setVisible,scan,interact,update,drawMarkers,diagnostics,"
    "serialize(){return {stage,carrying,integrity,discovered,history:history.map(x=>({...x}))};},"
    "restore(o){if(!o)return;stage=o.stage|0;carrying=!!o.carrying;integrity=+o.integrity||100;discovered=!!o.discovered;history=(o.history||[]).map(x=>({...x}));scanUntil=0;refresh();},"
    "get heatBonus(){return stage>=2?.16:0;}};")

# ---------------------------------------------------------------- crew save
rep("return {characters,imported,toggle,act,tick,setPlaying,reset,attachRenderer(fn){renderer=fn;},",
    "return {characters,imported,toggle,act,tick,setPlaying,reset,serialize(){return [...talked];},restore(o){talked.clear();(o||[]).forEach(t=>talked.add(t));},attachRenderer(fn){renderer=fn;},")

# ---------------------------------------------------------------- three quality levels
rep("window.ICEWALK_VISUALS={quality:'balanced',photo:false,change(){this.quality=this.quality==='balanced'?'cinematic':'balanced';document.getElementById('qualityBtn').textContent='GRAFİK · '+(this.quality==='cinematic'?'SİNEMA':'DENGELİ');},",
    "window.ICEWALK_VISUALS={quality:(()=>{try{const q=localStorage.getItem('antarktikaQuality');if(['low','balanced','cinematic'].includes(q))return q;}catch(_){}return 'balanced';})(),photo:false,"
    "levels:['low','balanced','cinematic'],labels:{low:'DÜŞÜK',balanced:'ORTA',cinematic:'YÜKSEK'},"
    "change(){const L=this.levels;this.quality=L[(L.indexOf(this.quality)+1)%L.length];try{localStorage.setItem('antarktikaQuality',this.quality);}catch(_){}this.label();},"
    "label(){const b=document.getElementById('qualityBtn');if(b)b.textContent='GRAFİK · '+this.labels[this.quality];},")
rep("document.getElementById('qualityBtn').addEventListener('click',()=>window.ICEWALK_VISUALS.change());",
    "document.getElementById('qualityBtn').addEventListener('click',()=>window.ICEWALK_VISUALS.change());window.ICEWALK_VISUALS.label();")

# ---------------------------------------------------------------- test flag: allow software WebGL (headless CI only)
rep("if(/swiftshader|llvmpipe|software rasterizer/i.test(rendererName)){",
    "if(/swiftshader|llvmpipe|software rasterizer/i.test(rendererName)&&!/[?&]forcewebgl=1/.test(location.search)){")

# ---------------------------------------------------------------- load the asset layer before the engine
rep("</script><script>\n/* ANTARKTIKA // WHITEOUT — ICEWALK. Standalone WebGL first-person expedition. */",
    "</script><script src=\"js/a3d.js\"></script><script>\n/* ANTARKTIKA // WHITEOUT — ICEWALK. Standalone WebGL first-person expedition. */")

# ---------------------------------------------------------------- keep spires / crates out of the modelled sites
rep("const ice=mesh(),rocks=mesh(),dark=mesh(),white=mesh(),orange=mesh(),steel=mesh(),glows=mesh(),alienGlow=mesh(),mountains=mesh(),crack=mesh();",
    "const ice=mesh(),rocks=mesh(),dark=mesh(),white=mesh(),orange=mesh(),steel=mesh(),glows=mesh(),alienGlow=mesh(),mountains=mesh(),crack=mesh();\n"
    "// Blender-modelled sites (ice cave, HELIKON-14 station) stay clear of random scatter.\n"
    "const keepClear=(x,z,pad=0)=>(x>-24-pad&&x<6+pad&&z>-60-pad&&z<-22+pad)||(x>-4-pad&&x<50+pad&&z>10-pad&&z<46+pad);")
rep("if(path<15 || (x>10&&x<45&&z<-80&&z>-245))continue;",
    "if(path<15 || (x>10&&x<45&&z<-80&&z>-245) || keepClear(x,z,5))continue;")
rep("for(let i=0;i<35;i++){let z=rand(-245,67),x=rand(-80,80);if(Math.abs(x)<5)continue;",
    "for(let i=0;i<35;i++){let z=rand(-245,67),x=rand(-80,80);if(Math.abs(x)<5||keepClear(x,z,1.5))continue;")

# ---------------------------------------------------------------- shelter + relic become replaceable fallbacks
rep("function addScene(src,kind,tint=[1,1,1]){if(src.p.length)scene.push({...makeGPU(src),kind,tint});}",
    "function addScene(src,kind,tint=[1,1,1],fallback=null){if(src.p.length)scene.push({...makeGPU(src),kind,tint,fallback});}")
rep("const x=23,z=27,y=terrainY(x,z);box(dark,x,y,z,18,3.7,9,-.12);box(white,x,y+3.7,z,18,1.2,9,-.12);box(steel,x-6,y,z+5,2.2,2.2,1.5);box(orange,x-6,y+.6,z+5.85,1.12,1.6,.14);box(dark,x+11,y,z-4.5,9,.9,1.9,-.15);box(steel,x+11,y+.8,z-4.5,8,.09,1.7,-.15);cylinder(steel,x+7,y+4.7,z-1,.14,9);cylinder(glows,x+7,y+13.9,z-1,.45,.44);for(let i=-1;i<=1;i++){box(steel,x-12+i*2.4,y,z-3,1.8,.8,3.1);}}",
    "const x=23,z=27,y=terrainY(x,z),dark=mesh(),white=mesh(),steel=mesh(),orange=mesh(),glows=mesh();box(dark,x,y,z,18,3.7,9,-.12);box(white,x,y+3.7,z,18,1.2,9,-.12);box(steel,x-6,y,z+5,2.2,2.2,1.5);box(orange,x-6,y+.6,z+5.85,1.12,1.6,.14);box(dark,x+11,y,z-4.5,9,.9,1.9,-.15);box(steel,x+11,y+.8,z-4.5,8,.09,1.7,-.15);cylinder(steel,x+7,y+4.7,z-1,.14,9);cylinder(glows,x+7,y+13.9,z-1,.45,.44);for(let i=-1;i<=1;i++){box(steel,x-12+i*2.4,y,z-3,1.8,.8,3.1);}\n"
    " // Procedural shelter = fallback; hidden once the Blender station has loaded.\n"
    " addScene(dark,3,[.11,.23,.30],'station');addScene(white,3,[.72,.84,.84],'station');addScene(orange,4,[.94,.35,.13],'station');addScene(steel,5,[.42,.60,.66],'station');addScene(glows,6,[1.0,.64,.24],'station');}")
rep("addScene(prologueRelic,6,[.18,.84,.96]);", "addScene(prologueRelic,6,[.18,.84,.96],'cave');")

# ---------------------------------------------------------------- quality-aware resolution
rep("function resize(){resolution=Math.min(devicePixelRatio||1,window.ICEWALK_VISUALS.quality==='cinematic'?2:1.25);",
    "function resize(){resolution=Math.min(devicePixelRatio||1,{low:.8,balanced:1.25,cinematic:2}[window.ICEWALK_VISUALS.quality]||1.25);")

# ---------------------------------------------------------------- interaction: A3D first, then the original order
rep("function interact(){if(state!=='play')return;if(window.ICEWALK_PROLOGUE.active){window.ICEWALK_PROLOGUE.act('E',player.x,player.z,prologueCutscene,toast);return;}const crewLine=window.ICEWALK_MESHY.act(player.x,player.z);if(crewLine){toast(crewLine);return;}let evidence=window.ICEWALK_FIELD.collect(player.x,player.z);if(evidence){chirp(840);toast(evidence);return;}let cargo=window.ICEWALK_CARGO.interact(player.x,player.z);if(cargo){chirp(840);toast(cargo);return;}let dist=nearby();if(dist<8&&mission===3&&!window.ICEWALK_STORY_CHOICE){toast('ÖNCE HELIKON ŞEHRİNDEKİ KARARINI VER.');return;}if(dist<8){nextMission();}else toast('Etkileşim için işaretli cihaza yaklaş.');}",
    "function interact(){if(state!=='play')return;const A3=window.ANTARKTIKA3D;const a3=A3&&A3.interact(player.x,player.z);if(a3){toast(a3);return;}"
    "if(window.ICEWALK_PROLOGUE.active){window.ICEWALK_PROLOGUE.act('E',player.x,player.z,prologueCutscene,toast);saveNow('prologue');return;}"
    "const crewLine=window.ICEWALK_MESHY.act(player.x,player.z);if(crewLine){const ex=window.ICEWALK_MESHY.characters.find(c=>c.id==='explorer');if(ex&&Math.hypot(ex.x-player.x,ex.z-player.z)<4.2)A3?.talk('explorer');toast(crewLine);return;}"
    "const sealed=A3&&A3.blockCollect(player.x,player.z);let evidence=sealed?null:window.ICEWALK_FIELD.collect(player.x,player.z);if(evidence){chirp(840);toast(evidence);saveNow('evidence');return;}"
    "let cargo=window.ICEWALK_CARGO.interact(player.x,player.z);if(cargo){chirp(840);toast(cargo);saveNow('cargo');return;}if(sealed){toast(sealed);return;}"
    "let dist=nearby();if(dist<8&&mission===3&&!window.ICEWALK_STORY_CHOICE){toast('ÖNCE HELIKON ŞEHRİNDEKİ KARARINI VER.');return;}"
    "const gate=dist<8&&A3?A3.blocksMission(mission,player.x,player.z):null;if(gate){toast(gate);return;}"
    "if(dist<8){nextMission();}else toast('Etkileşim için işaretli cihaza yaklaş.');}")
rep("function nextMission(){achieved[mission]=true;window.ICEWALK_JOURNAL.collect(mission+1);chirp(550+mission*75);",
    "function saveNow(why){try{window.ANTARKTIKA_SAVE?.save(why);}catch(e){console.warn(e);}}\n"
    "function nextMission(){achieved[mission]=true;window.ICEWALK_JOURNAL.collect(mission+1);chirp(550+mission*75);setTimeout(()=>saveNow('mission'),0);")
# Q: the scanner also sweeps the 3D world (and replays the crystal order inside the cave)
rep("chirp(700);let a=window.ICEWALK_FIELD.ping(player.x,player.z,elapsed);",
    "chirp(700);window.ANTARKTIKA3D?.onScan(player.x,player.z);let a=window.ICEWALK_FIELD.ping(player.x,player.z,elapsed);")
rep("function start(){window.ICEWALK_STORY_CHOICE=null;",
    "function start(){window.ICEWALK_STORY_CHOICE=null;window.ANTARKTIKA3D?.resetState();", count=2)
rep("function pause(){if(state!=='play')return;pressed.clear();state='paused';",
    "function pause(){if(state!=='play')return;pressed.clear();state='paused';saveNow('pause');")

# ---------------------------------------------------------------- movement: analog input, collisions, floors, zones
rep("let run=isDown('shift')&&player.stamina>4;",
    "let run=isDown('shift')&&player.stamina>4;const IN=window.ICEWALK_INPUT;let analog=1;"
    "if(IN&&IN.active){x=IN.x;z=IN.z;analog=Math.min(1,Math.hypot(x,z));run=(run||IN.run||analog>.96)&&player.stamina>4;}"
    "if(IN&&(IN.dyaw||IN.dpitch)){player.yaw+=IN.dyaw;player.pitch=clamp(player.pitch-IN.dpitch,-1.38,1.38);IN.dyaw=0;IN.dpitch=0;}")
rep("let speed=(run?7.7:4.25)*(player.warmth<15?.65:1);",
    "let speed=(run?7.7:4.25)*(player.warmth<15?.65:1)*(IN&&IN.active?Math.max(.3,analog):1);")
rep("let nx=clamp(player.x+player.spdX*dt,-295,295),nz=clamp(player.z+player.spdZ*dt,-352,105);\nconst drop=terrainY(nx,nz)-terrainY(player.x,player.z);let blocked=drop>1.1&&Math.hypot(nx-player.x,nz-player.z)<1.2;\n// Extremely deep fissures are impassable without equipment.\nif(terrainY(nx,nz)<terrainY(player.x,player.z)-2.5)blocked=true;",
    "let nx=clamp(player.x+player.spdX*dt,-295,295),nz=clamp(player.z+player.spdZ*dt,-352,105);\n"
    "if(window.ANTARKTIKA3D){const c=window.ANTARKTIKA3D.collide(player.x,player.z,nx,nz);nx=c[0];nz=c[1];}\n"
    "const drop=groundY(nx,nz)-groundY(player.x,player.z);let blocked=drop>1.1&&Math.hypot(nx-player.x,nz-player.z)<1.2;\n// Extremely deep fissures are impassable without equipment.\nif(groundY(nx,nz)<groundY(player.x,player.z)-2.5)blocked=true;")
rep("if(v>1.25){footTimer-=dt;if(footTimer<=0){stepSound(clamp(v/5,.6,1.5));if(!blocked)window.ICEWALK_TRACKS.stamp(player.x,player.z,player.spdX,player.spdZ,elapsed);footTimer=run?.33:.47;}}else footTimer=0;",
    "if(v>1.25){footTimer-=dt;if(footTimer<=0){const surf=window.ANTARKTIKA3D?window.ANTARKTIKA3D.surface(player.x,player.z):'snow';if(surf==='metal')window.ANTARKTIKA3D.footstep(clamp(v/5,.6,1.5),'metal');else stepSound(clamp(v/5,.6,1.5));if(!blocked&&surf!=='metal')window.ICEWALK_TRACKS.stamp(player.x,player.z,player.spdX,player.spdZ,elapsed);footTimer=run?.33:.47;}}else footTimer=0;")
rep("let nearShelter=Math.hypot(player.x-23,player.z-27)<21;\nplayer.warmth=clamp(player.warmth+(nearShelter?7.2:(-.095-storm*.24)*(1-window.ICEWALK_CARGO.heatBonus))*dt,0,100);",
    "let nearShelter=Math.hypot(player.x-23,player.z-27)<21;const zone=window.ANTARKTIKA3D?.zone||null;\n"
    "player.warmth=clamp(player.warmth+(zone==='indoor'?11:nearShelter?7.2:(-.095-storm*(zone==='cave'?.07:.24))*(1-window.ICEWALK_CARGO.heatBonus))*dt,0,100);")
rep("if(windGain)windGain.gain.setTargetAtTime(.045+storm*.21,audioc.currentTime,.32);\nif(windFilter)windFilter.frequency.setTargetAtTime(250+storm*500,audioc.currentTime,.4);",
    "const shelterF=zone==='indoor'?.22:zone==='cave'?.45:1;\n"
    "if(windGain)windGain.gain.setTargetAtTime((.045+storm*.21)*shelterF,audioc.currentTime,.32);\nif(windFilter)windFilter.frequency.setTargetAtTime((250+storm*500)*(zone?.55:1),audioc.currentTime,.4);")
rep("if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)notice.classList.remove('show');}\n}",
    "if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)notice.classList.remove('show');}\nwindow.ANTARKTIKA3D?.update(dt);\n}")

# ---------------------------------------------------------------- rendering hooks
rep("let eye=[player.x,terrainY(player.x,player.z)+1.71+bob+breath,player.z]",
    "let eye=[player.x,groundY(player.x,player.z)+1.71+bob+breath,player.z]")
rep("drawMesh(terrain);for(let me of scene)drawMesh(me);for(const me of crewGeometry){if(!loadedMeshes[me.crewId])drawMesh(me);}for(const list of Object.values(loadedMeshes)){for(const me of list)drawMesh(me);}renderTracks(view);",
    "drawMesh(terrain);const A3=window.ANTARKTIKA3D;for(let me of scene){if(me.fallback&&A3&&A3.replaces(me.fallback))continue;drawMesh(me);}for(const me of crewGeometry){if(!loadedMeshes[me.crewId]&&!(A3&&A3.replaces('crew:'+me.crewId)))drawMesh(me);}for(const list of Object.values(loadedMeshes)){for(const me of list)drawMesh(me);}"
    "if(A3)A3.draw(view,proj,eye,f,{storm,torch});renderTracks(view);")
rep("gl.vertexAttribPointer(s.size,1,gl.FLOAT,false,0,0);gl.drawArrays(gl.POINTS,0,FLAKES);",
    "gl.vertexAttribPointer(s.size,1,gl.FLOAT,false,0,0);const flakeN=Math.round(FLAKES*(window.ANTARKTIKA3D?window.ANTARKTIKA3D.snowFactor():1)*(window.ICEWALK_VISUALS.quality==='low'?.45:1));if(flakeN>0)gl.drawArrays(gl.POINTS,0,flakeN);")
rep("$('screenSnow').style.opacity=String(clamp(.07+storm*.36,0,.45));",
    "$('screenSnow').style.opacity=String(clamp(.07+storm*.36,0,.45)*(window.ANTARKTIKA3D?window.ANTARKTIKA3D.snowFactor():1));")

# ---------------------------------------------------------------- engine API for A3D + save system
rep("// Platform diagnostics, intentionally read-only and safe for test automation.",
    "function groundY(x,z){return window.ANTARKTIKA3D?window.ANTARKTIKA3D.groundY(x,z):terrainY(x,z);}\n"
    "window.ANTARKTIKA3D?.init({gl,terrainY,objects,get player(){return player;},get state(){return state;},get mission(){return mission;},get storm(){return storm;},get torch(){return torch;},"
    "get audio(){return audioc;},get master(){return master;},toast,completeMission(){if(state==='play'&&mission<6)nextMission();},save(){saveNow('a3d');},"
    "onReady(){const st=document.getElementById('status-explorer');if(st)st.textContent='Oyunda: özgün Blender modeli · iskelet + 4 animasyon';}});\n"
    "window.ICEWALK_ENGINE={get state(){return state;},get mission(){return mission;},"
    "missionTitle(m){return window.ICEWALK_CAMPAIGN.missionTitles[m]||'BÖLÜM TAMAM';},"
    "serialize(){return {player:{x:player.x,z:player.z,yaw:player.yaw,pitch:player.pitch,stamina:player.stamina,warmth:player.warmth,dist:player.dist},elapsed,mission,achieved:[...achieved],torch,chapter:state==='chapter',choice:window.ICEWALK_STORY_CHOICE||null};},"
    "startFresh(){start();},"
    "step(dt=1/30,n=1){for(let i=0;i<n;i++){if(state==='play'&&!window.ICEWALK_CHAMBER?.active)update(dt);}},"
    "continueFrom(o,after){start();if(after)after();const P=o.player||{};Object.assign(player,{x:+P.x||0,z:+P.z||35,yaw:+P.yaw||0,pitch:+P.pitch||0,stamina:+P.stamina||100,warmth:Math.max(40,+P.warmth||100),dist:+P.dist||0,spdX:0,spdZ:0});"
    "elapsed=+o.elapsed||0;mission=Math.min(6,o.mission|0);achieved=Array.isArray(o.achieved)?o.achieved:Array(6).fill(false);torch=!!o.torch;window.ICEWALK_STORY_CHOICE=o.choice||null;"
    "const pro=window.ICEWALK_PROLOGUE.active;window.ICEWALK_FIELD.setVisible(!pro);window.ICEWALK_CARGO.setVisible(!pro);if(!pro)window.ICEWALK_PROLOGUE.mainUI();"
    "if(o.chapter){beginMain();}toast(pro?'KAYIT YÜKLENDİ · PROLOGUE SÜRÜYOR':'KAYIT YÜKLENDİ · '+(window.ICEWALK_CAMPAIGN.missionTitles[mission]||'SERBEST KEŞİF'));}};\n"
    "// Platform diagnostics, intentionally read-only and safe for test automation.")
rep("storyPhase:window.ICEWALK_CAMPAIGN.phase,prologue:window.ICEWALK_PROLOGUE.summary()});",
    "storyPhase:window.ICEWALK_CAMPAIGN.phase,prologue:window.ICEWALK_PROLOGUE.summary(),a3d:window.ANTARKTIKA3D?window.ANTARKTIKA3D.diagnostics():null,quality:window.ICEWALK_VISUALS.quality,save:window.ANTARKTIKA_SAVE?window.ANTARKTIKA_SAVE.summary():null});", count=2)
rep("$('startBtn').addEventListener('click',()=>{if(state==='paused')resume();else if(state==='chapter')beginMain();else start();});",
    "$('startBtn').addEventListener('click',()=>{if(state==='paused')resume();else if(state==='chapter'){beginMain();saveNow('chapter');}else{window.ANTARKTIKA_SAVE?.clear();start();saveNow('new');}});")

# ---------------------------------------------------------------- terrain: 6x6 chunks + frustum culling
# Same vertices and triangles as before, indices regrouped per tile so tiles outside
# the view frustum are skipped (the 120k-triangle grid was drawn whole every frame).
rep("for(let j=0;j<RES;j++)for(let i=0;i<RES;i++){const a=j*(RES+1)+i,b=a+RES+1;indices.push(a,b,a+1,a+1,b,b+1);}",
    "const TILE=41,terrainChunks=[];for(let tj=0;tj<RES;tj+=TILE)for(let ti=0;ti<RES;ti+=TILE){const start=indices.length;let y0=1e9,y1=-1e9;"
    "for(let j=tj;j<Math.min(RES,tj+TILE);j++)for(let i=ti;i<Math.min(RES,ti+TILE);i++){const a=j*(RES+1)+i,b=a+RES+1;indices.push(a,b,a+1,a+1,b,b+1);y0=Math.min(y0,tPos[a*3+1],tPos[b*3+1]);y1=Math.max(y1,tPos[a*3+1],tPos[b*3+1]);}"
    "const x0=XMIN+ti*(XMAX-XMIN)/RES,x1=XMIN+Math.min(RES,ti+TILE)*(XMAX-XMIN)/RES,z0=ZMIN+tj*(ZMAX-ZMIN)/RES,z1=ZMIN+Math.min(RES,tj+TILE)*(ZMAX-ZMIN)/RES;"
    "y0-=1;y1+=1;terrainChunks.push({off:start*2,count:indices.length-start,c:[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2],r:Math.hypot(x1-x0,y1-y0,z1-z0)/2});}")
rep("drawMesh(terrain);",
    "{const vp=new Float32Array(16);for(let c=0;c<4;c++)for(let rr=0;rr<4;rr++)vp[c*4+rr]=proj[rr]*view[c*4]+proj[4+rr]*view[c*4+1]+proj[8+rr]*view[c*4+2]+proj[12+rr]*view[c*4+3];"
    "const pl=[];for(const [sg,k] of [[1,0],[-1,0],[1,1],[-1,1],[1,2],[-1,2]]){const a=vp[3]+sg*vp[k],b=vp[7]+sg*vp[4+k],c=vp[11]+sg*vp[8+k],d=vp[15]+sg*vp[12+k],l=Math.hypot(a,b,c);pl.push([a/l,b/l,c/l,d/l]);}"
    "gl.bindBuffer(gl.ARRAY_BUFFER,terrain.p);gl.enableVertexAttribArray(m.pos);gl.vertexAttribPointer(m.pos,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,terrain.n);gl.enableVertexAttribArray(m.norm);gl.vertexAttribPointer(m.norm,3,gl.FLOAT,false,0,0);"
    "gl.uniform1f(m.kind,terrain.kind);gl.uniform3fv(m.tint,terrain.tint);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,terrain.i);let tv=0;"
    "for(const ch of terrainChunks){let out=false;for(const q of pl)if(q[0]*ch.c[0]+q[1]*ch.c[1]+q[2]*ch.c[2]+q[3]<-ch.r){out=true;break;}if(out)continue;gl.drawElements(gl.TRIANGLES,ch.count,gl.UNSIGNED_SHORT,ch.off);tv+=ch.count/3;}"
    "window.ICEWALK_TERRAIN_DRAWN=tv;}")

# ---------------------------------------------------------------- stereo / external camera (VR via js/xr.js)
rep("function render(){resize();const d=direction();", "function render(X){if(!X)resize();const d=direction();")
rep("let view=lookAt(eye,f,r,u);gl.disable(gl.DEPTH_TEST);",
    "let view=lookAt(eye,f,r,u);if(X){eye=X.eye;f=X.f;r=X.r;u=X.u;view=X.view;proj=X.proj;aspect=X.aspect;}gl.disable(gl.DEPTH_TEST);")
rep("gl.uniform1f(sky.tan,Math.tan(76*PI/360));", "gl.uniform1f(sky.tan,X?X.tan:Math.tan(76*PI/360));")
rep("if(A3)A3.draw(view,proj,eye,f,{storm,torch});", "if(A3)A3.draw(view,proj,eye,f,{storm,torch,xr:X?X.xr:null});")
rep("// Position the objective marker against the camera", "if(X)return;\n// Position the objective marker against the camera")
rep("function frame(now){let dt=clamp((now-prev)/1000,0,.045);prev=now;",
    "function frame(now){if(window.ANTARKTIKA_XR&&window.ANTARKTIKA_XR.active){prev=now;requestAnimationFrame(frame);return;}let dt=clamp((now-prev)/1000,0,.045);prev=now;")
rep("startFresh(){start();},", "startFresh(){start();},renderView(X){render(X);},get player(){return player;},")

# ---------------------------------------------------------------- touch controls (replaces the original script block)
start = s.index("<script>\n(()=>{if(!matchMedia('(pointer:coarse)').matches")
end = s.index("</script>", start) + len("</script>")
s = s[:start] + '<script src="js/touch.js"></script>' + s[end:]

# ---------------------------------------------------------------- save system + perf overlay at the end of the body
rep("</body></html>", '<script src="js/save.js"></script><script src="js/perf.js"></script><script src="js/xr.js"></script></body></html>')

open(path, "w", encoding="utf-8").write(s)
print("patched", path, len(s))
