// fx-xr: the game in a VR headset (WebXR, Meta Quest browser and any WebXR runtime).
// The desktop game is untouched until a headset session starts. While one runs:
// - the head sets where Ekin stands, faces and crouches; the camera rides a rig that the game moves (stick, snap turn,
//   collisions push the rig back so walking through a wall in the room does not walk you through it in the game);
// - the torch is in the left hand, the camcorder in the right, and the right hand aims what you interact with and film;
// - the HTML overlays (subtitles, prompt, chapter cards, documents, fade) are mirrored onto a panel in front of you.
// Controls (Touch controllers): left stick walk (click: sprint), right stick snap turn (down: crouch toggle, though a
// real crouch works too), right trigger / A interact, right grip camcorder, left trigger torch.

const XR_RIG = new THREE.Group(); XR_RIG.name = 'xrRig';
const SNAP = 30 * D2R, DEAD = .18;
const xr = FX.xr = { on: false, mx: 0, mz: 0, sprint: false, snapArmed: true, crouchArmed: true, aligned: false, comfort: 1, stick: 0 };
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);

/* ---- hands ---- */
const hands = [0, 1].map((i) => {
  const grip = renderer.xr.getControllerGrip(i), aim = renderer.xr.getController(i);
  const h = { i, grip, aim, side: null, gamepad: null };
  aim.addEventListener('connected', (e) => { h.side = e.data.handedness; h.gamepad = e.data.gamepad || null; });
  aim.addEventListener('disconnected', () => { h.side = null; h.gamepad = null; });
  XR_RIG.add(grip, aim);
  return h;
});
const hand = (side) => hands.find((h) => h.side === side) || null;

// a plain torch body for the left hand: the light itself is the game's torch, carried over
const torchBody = new THREE.Group();
{
  const metal = new THREE.MeshPhongMaterial({ color: 0x1b1c1e, specular: 0x222222, shininess: 30 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .15, 16), metal); body.rotation.x = Math.PI / 2; body.position.z = .03;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.024, .017, .045, 16), metal); head.rotation.x = Math.PI / 2; head.position.z = -.065;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.021, 16), new THREE.MeshBasicMaterial({ color: 0xfff1dc }));
  lens.position.z = -.0885; lens.rotation.y = Math.PI; lens.name = 'lens';
  torchBody.add(body, head, lens);
}
const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0xe4ded2, transparent: true, opacity: .35, fog: false }));
laser.visible = false;

/* ---- the panel that carries the HTML overlays ---- */
const PW = 1024, PH = 640;
const panelCanvas = document.createElement('canvas'); panelCanvas.width = PW; panelCanvas.height = PH;
const panelTex = new THREE.CanvasTexture(panelCanvas); panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.04, .65), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
panel.renderOrder = 1001; panel.visible = false;
const fadeShell = new THREE.Mesh(new THREE.SphereGeometry(.4, 24, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fadeShell.renderOrder = 1000;
// comfort: the edges of the view darken while the stick moves you
const vigCanvas = document.createElement('canvas'); vigCanvas.width = vigCanvas.height = 256;
{ const g = vigCanvas.getContext('2d'), gr = g.createRadialGradient(128, 128, 52, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.55, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(.62, .62), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(vigCanvas), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
vignette.position.z = -.2; vignette.renderOrder = 999;
// raised camcorder: a thin viewfinder frame with the REC line, fixed to the view
const camCanvas = document.createElement('canvas'); camCanvas.width = 1024; camCanvas.height = 576;
const camTex = new THREE.CanvasTexture(camCanvas); camTex.colorSpace = THREE.SRGBColorSpace;
const camFrame = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .9), new THREE.MeshBasicMaterial({ map: camTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
camFrame.position.z = -1.1; camFrame.renderOrder = 998; camFrame.visible = false;

const text = (id) => { const e = $(id); return e ? e.innerText.trim() : ''; };
const shown = (id) => { const e = $(id); return !!e && !e.hidden; };
function wrap(g, s, maxW) {
  const out = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      const tryL = line + w;
      if (g.measureText(tryL.trim()).width > maxW && line.trim()) { out.push(line.trim()); line = w.trimStart(); } else line = tryL;
    }
    out.push(line.trim());
  }
  return out.filter((l, i, a) => l || (i > 0 && a[i - 1]));
}
let panelKey = '';
function drawPanel() {
  const reading = state.reading && shown('reader');
  const card = parseFloat(getComputedStyle($('card')).opacity) > .05 ? text('cardText') : '';
  const sp = $('subs').firstElementChild, who = sp && sp.querySelector('span') ? sp.querySelector('span').textContent : '';
  const subs = sp ? (who ? `${who}: ${sp.textContent.slice(who.length)}` : sp.textContent).trim() : '', toast = $('toast').classList.contains('show') ? text('toast') : '';
  const prompt = state.focus ? `[${t('TETİK')}]  ${t(state.focus.prompt)}` : '';
  const key = reading ? `R|${text('readerTitle')}|${text('readerText')}` : `${card}|${subs}|${toast}|${prompt}`;
  if (key === panelKey) return; panelKey = key;
  const g = panelCanvas.getContext('2d'); g.clearRect(0, 0, PW, PH);
  if (key === '|||') { panel.visible = false; return; }
  panel.visible = true;
  const font = (px, w = 400) => `${w} ${px}px "IBM Plex Sans Condensed", system-ui, sans-serif`;
  if (reading) { // a document: paper in front of you
    g.fillStyle = 'rgba(232,226,212,.97)'; g.fillRect(40, 20, PW - 80, PH - 40);
    g.fillStyle = '#1d1a16'; g.font = font(44, 600); g.fillText(text('readerTitle'), 80, 90, PW - 160);
    g.font = font(36); let y = 150;
    for (const l of wrap(g, text('readerText'), PW - 160)) { if (y > PH - 80) break; g.fillText(l, 80, y); y += 46; }
    g.fillStyle = '#5a5248'; g.font = font(24); g.fillText(`[${t('TETİK')}]`, 80, PH - 52);
  } else {
    // sizes for a headset: the panel is 1.04 m wide at 1.25 m, so a 44 px line of 1024 spans about 2° of view, the usual minimum for reading in a headset
    let y = 70;
    if (card) { g.textAlign = 'center'; g.fillStyle = '#e4ded2'; g.font = font(52, 500); for (const l of wrap(g, card, PW - 100)) { g.fillText(l, PW / 2, y); y += 62; } g.textAlign = 'left'; y += 16; }
    if (toast) { g.font = font(38); const ls = wrap(g, toast, PW - 140); g.fillStyle = 'rgba(10,10,12,.8)'; g.fillRect(40, y - 44, PW - 80, ls.length * 48 + 26); g.fillStyle = '#e4ded2'; for (const l of ls) { g.fillText(l, 64, y); y += 48; } }
    const bottom = prompt ? PH - 92 : PH - 24;
    if (subs) { g.font = font(44); const ls = wrap(g, subs, PW - 110).slice(-3); let sy = bottom - ls.length * 56 + 40; g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(30, sy - 50, PW - 60, ls.length * 56 + 22); g.fillStyle = '#f2ede2'; for (const l of ls) { g.fillText(l, 55, sy); sy += 56; } }
    if (prompt) { g.font = font(42, 500); g.fillStyle = 'rgba(0,0,0,.65)'; const w = Math.min(PW - 40, g.measureText(prompt).width); g.fillRect(PW / 2 - w / 2 - 22, PH - 72, w + 44, 62); g.fillStyle = '#e4ded2'; g.textAlign = 'center'; g.fillText(prompt, PW / 2, PH - 27, PW - 60); g.textAlign = 'left'; }
  }
  panelTex.needsUpdate = true;
}
let camKey = '';
function drawCamFrame() {
  const key = `${text('recTime')}|${state.dwellTarget ? Math.round(state.dwell / state.dwellTarget.secs * 20) : -1}`;
  if (key === camKey) return; camKey = key;
  const g = camCanvas.getContext('2d'), W2 = camCanvas.width, H2 = camCanvas.height; g.clearRect(0, 0, W2, H2);
  g.strokeStyle = 'rgba(228,222,210,.55)'; g.lineWidth = 4; const c = 60, m = 30;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W2 - m, m, -1, 1], [m, H2 - m, 1, -1], [W2 - m, H2 - m, -1, -1]]) { g.beginPath(); g.moveTo(x + dx * c, y); g.lineTo(x, y); g.lineTo(x, y + dy * c); g.stroke(); }
  g.fillStyle = '#d33'; g.beginPath(); g.arc(m + 40, m + 52, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(228,222,210,.85)'; g.font = '34px VT323, monospace'; g.fillText(text('recTime'), m + 62, m + 63);
  if (state.dwellTarget) { const k = clamp(state.dwell / state.dwellTarget.secs, 0, 1); g.fillStyle = 'rgba(228,222,210,.25)'; g.fillRect(W2 / 2 - 120, H2 - m - 30, 240, 8); g.fillStyle = 'rgba(228,222,210,.9)'; g.fillRect(W2 / 2 - 120, H2 - m - 30, 240 * k, 8); }
  camTex.needsUpdate = true;
}

/* ---- session ---- */
const kept = { parentTorch: null, torchPos: new THREE.Vector3(), quality: null };
const head = new THREE.Vector3(), q = new THREE.Quaternion(), e3 = new THREE.Euler(0, 0, 0, 'YXZ');
function headPose() { XR_RIG.updateMatrixWorld(true); camera.getWorldPosition(head); camera.getWorldQuaternion(q); e3.setFromQuaternion(q, 'YXZ'); }
function enter() {
  xr.on = true; xr.aligned = false; xr.waitPose = 0;
  scene.add(XR_RIG); XR_RIG.position.set(player.x, 0, player.z); XR_RIG.rotation.set(0, 0, 0);
  scene.remove(camera); XR_RIG.add(camera); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  camera.add(panel, fadeShell, vignette, camFrame); panel.position.set(0, -.18, -1.25);
  kept.parentTorch = torch.parent; kept.torchPos.copy(torch.position);
  kept.quality = FX.quality; if (FX.quality !== 'low') { FX.quality = 'low'; FX.emit('quality', 'low'); } // a mobile headset at 72-90 Hz in each eye
  if (paused) setPaused(false);
}
function leave() {
  xr.on = false; xr.mx = xr.mz = 0; xr.sprint = false;
  camera.remove(panel, fadeShell, vignette, camFrame);
  XR_RIG.remove(camera); scene.add(camera); scene.remove(XR_RIG);
  if (kept.parentTorch) { kept.parentTorch.add(torch, torch.target); torch.position.copy(kept.torchPos); torch.target.position.set(0, -.05, -1); }
  torchBody.removeFromParent(); laser.removeFromParent();
  if (handCam.obj) camera.add(handCam.obj);
  if (kept.quality && kept.quality !== FX.quality) { FX.quality = kept.quality; FX.emit('quality', kept.quality); }
  resize();
}
renderer.xr.addEventListener('sessionstart', enter);
renderer.xr.addEventListener('sessionend', leave);
let session = null;
async function startVR(fromSave) {
  try {
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  } catch (e) { console.warn('XR', e); toast(t('VR oturumu açılamadı.')); return; }
  session.addEventListener('end', () => { session = null; });
  await renderer.xr.setSession(session);
  await ready; begin(fromSave);
}
xr.start = startVR; xr.end = () => session && session.end();
xr.parts = { rig: XR_RIG, panel, torchBody, camFrame, hand }; // for the automated headset test
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    const b = $('vrBtn'); if (!b) return;
    const dot = b.querySelector('.dot'), label = () => { b.replaceChildren(dot, document.createTextNode(t(loadSave() ? "VR'da devam et" : "VR'da oyna"))); };
    label(); FX.on('lang', label); b.hidden = false;
    b.addEventListener('click', () => { if (!state.started) startVR(loadSave()); });
  }).catch(() => {});
}

/* ---- input ---- */
function stickOf(h) { const a = h && h.gamepad && h.gamepad.axes; if (!a) return [0, 0]; return a.length >= 4 ? [a[2], a[3]] : [a[0] || 0, a[1] || 0]; }
const pressed = (h, i) => !!(h && h.gamepad && h.gamepad.buttons[i] && h.gamepad.buttons[i].pressed);
const prev = {};
function edge(id, now) { const was = prev[id]; prev[id] = now; return now && !was; }
const live = () => xr.on && state.started && !state.ended && !paused;
for (const h of hands) {
  h.aim.addEventListener('selectstart', () => { if (!live()) return; if (h.side === 'left') { if (player.enabled) toggleTorch(); } else doInteract(); });
  h.aim.addEventListener('squeezestart', () => { if (live() && h.side === 'right' && player.enabled && !state.reading) toggleCam(); });
}
function readSticks() {
  const L = hand('left'), R = hand('right');
  let [lx, ly] = stickOf(L); if (Math.hypot(lx, ly) < DEAD) lx = ly = 0;
  xr.mx = lx; xr.mz = -ly; xr.stick = Math.min(1, Math.hypot(lx, ly));
  if (edge('lclick', pressed(L, 3))) xr.sprint = !xr.sprint;
  if (xr.stick < .1) xr.sprint = false;
  const [rx, ry] = stickOf(R);
  if (Math.abs(rx) < .3) xr.snapArmed = true;
  else if (xr.snapArmed && Math.abs(rx) > .7) { xr.snapArmed = false; turn(-Math.sign(rx) * SNAP); }
  if (ry < .4) xr.crouchArmed = true;
  else if (xr.crouchArmed && ry > .8) { xr.crouchArmed = false; xr.crouchToggle = !xr.crouchToggle; }
  if (edge('a', pressed(R, 4)) && live()) doInteract();
}
// turn the rig about the head, so the head stays where it is
function turn(a) {
  headPose();
  const dx = XR_RIG.position.x - head.x, dz = XR_RIG.position.z - head.z, c = Math.cos(a), s = Math.sin(a);
  XR_RIG.position.x = head.x + dx * c + dz * s; XR_RIG.position.z = head.z - dx * s + dz * c; XR_RIG.rotation.y += a;
}

/* ---- the game's view of the head (called from updatePlayer) ---- */
// The game moves Ekin on its own too: a chapter start, a checkpoint after being caught. When player.x/z no longer hold
// what this module left there, the rig is carried over so the head lands on the new spot, facing the new way.
function placeHead(x, z, yaw) { headPose(); turn(yaw - e3.y); headPose(); XR_RIG.position.x += x - head.x; XR_RIG.position.z += z - head.z; headPose(); }
xr.before = () => {
  readSticks();
  // line the room up with the game once the headset reports a pose (or after a moment without one); until then the game's own spot stands
  if (!xr.aligned) { if (camera.position.lengthSq() < 1e-6 && ++xr.waitPose <= 20) return; xr.aligned = true; placeHead(player.x, player.z, player.yaw); }
  else if (Math.abs(player.x - xr.lastX) > 1e-4 || Math.abs(player.z - xr.lastZ) > 1e-4) placeHead(player.x, player.z, player.yaw);
  else headPose();
  player.x = head.x; player.z = head.z; player.yaw = e3.y; player.pitch = e3.x; // a scripted look (face()) never turns a player's head for them
  const hy = head.y - XR_RIG.position.y;
  player.eye = hy > .5 ? hy : 1.64; // an emulator or a seated 'local' space can report no height
  const low = (hy > .5 && hy < 1.2) || xr.crouchToggle;
  if (low !== player.crouched && (low || !blockedAbove())) player.crouched = low;
};
xr.after = () => {
  if (!xr.aligned) return;
  XR_RIG.position.x += player.x - head.x; XR_RIG.position.z += player.z - head.z; head.x = player.x; head.z = player.z;
  xr.lastX = player.x; xr.lastZ = player.z;
};

// aim: the right hand points (the camcorder is in it); without controllers the gaze aims as on the desktop
const ad = new THREE.Vector3();
FX.aim = (r) => {
  if (!xr.on) return false;
  const R = hand('right'); if (!R) return false;
  R.aim.updateMatrixWorld(true); R.aim.getWorldPosition(r.ray.origin); R.aim.getWorldQuaternion(q); ad.set(0, 0, -1).applyQuaternion(q); r.ray.direction.copy(ad);
  return true;
};

/* ---- per frame: hands, panel, fade, comfort ---- */
let fadeNow = 0;
FX.on('draw', (dt) => {
  if (!xr.on) return;
  const L = hand('left'), R = hand('right');
  // both are carried on the hand's pointing ray (not its grip, which tilts up along the handle), so they point where you point
  if (L && torch.parent !== L.aim) { L.aim.add(torch, torch.target, torchBody); torchBody.position.set(0, -.015, .03); torch.position.set(0, -.015, -.06); torch.target.position.set(0, -.06, -1); }
  torchBody.visible = state.started && !state.ended;
  torchBody.getObjectByName('lens').material.color.setHex(torch.visible ? 0xfff1dc : 0x2a2a2a);
  const o = handCam.obj;
  if (o && R) {
    if (o.parent !== R.aim) R.aim.add(o);
    o.position.set(0, -.045, .06); o.rotation.set(0, 0, 0); o.scale.setScalar(.75);
    o.visible = state.started && !state.ended && player.enabled; // in a headset the camcorder stays in your hand while it films
    if (laser.parent !== R.aim) R.aim.add(laser);
  }
  laser.visible = !!state.focus && !state.camRaised;
  if (laser.visible) { const hit = firstHit(W.interact, 2.3); laser.scale.z = hit ? hit.distance : 2.3; }
  // the HTML fade, as a shell around the head
  const want = parseFloat(getComputedStyle($('fade')).opacity) || 0; fadeNow = want; fadeShell.material.opacity = fadeNow; fadeShell.visible = fadeNow > .01;
  vignette.material.opacity += ((xr.stick > 0 ? .55 + xr.stick * .4 : 0) * xr.comfort - vignette.material.opacity) * Math.min(1, dt * 8);
  vignette.visible = vignette.material.opacity > .02;
  camFrame.visible = state.camRaised; if (camFrame.visible) drawCamFrame();
  drawPanel();
  if (state.ended && session && !xr.ending) { xr.ending = true; later(3500, () => { xr.ending = false; xr.end(); }); } // the end screen and the tape are HTML
});
