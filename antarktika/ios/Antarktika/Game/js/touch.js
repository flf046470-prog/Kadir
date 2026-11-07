/* ANTARKTIKA // WHITEOUT — touch controls.
 * Floating analog stick (appears under the thumb on the left half), direct camera
 * look on the right half, context-lit action buttons. The main engine reads
 * window.ICEWALK_INPUT (analog x/z, run, look deltas); the HELIKON chamber still
 * receives the synthetic WASD / mouse events it was written for. */
(() => {
  'use strict';
  const IN = (window.ICEWALK_INPUT = { active: false, x: 0, z: 0, run: false, dyaw: 0, dpitch: 0, sens: 1 });
  try { IN.sens = +localStorage.getItem('antarktikaLookSens') || 1; } catch (_) { /* private mode */ }
  if (!matchMedia('(pointer:coarse)').matches && !('ontouchstart' in window)) return;
  document.body.classList.add('touch-device');

  const root = document.getElementById('mobileControls');
  const pad = document.getElementById('mobilePad'), stick = document.getElementById('mobileStick'), look = document.getElementById('mobileLook');
  const zone = document.createElement('div');
  zone.id = 'moveZone'; zone.setAttribute('aria-label', 'Hareket bölgesi');
  root.prepend(zone);
  const css = document.createElement('style');
  css.textContent = `#moveZone{position:absolute;left:0;top:16%;width:46%;bottom:0;pointer-events:auto;touch-action:none}
#mobilePad{pointer-events:none;opacity:.42;transition:opacity .18s;left:max(22px,env(safe-area-inset-left));bottom:max(26px,env(safe-area-inset-bottom))}
#mobilePad.live{opacity:.95;transition:none}#mobileStick{transition:transform .08s}
#mobileLook{left:46%;right:0;width:auto;top:16%;height:auto;bottom:0}#mobileLook:after{content:'BAK · SÜRÜKLE'}
#mobileActions{z-index:2;grid-template-columns:repeat(4,56px)}#mobileActions button{min-height:52px;font-size:11px}
#mobileActions button.ready{background:#d9a35ee8;color:#081a24;box-shadow:0 0 18px #ffc98a88;animation:ePulse 1s ease-in-out infinite}
@keyframes ePulse{50%{transform:scale(1.06)}}
@media (max-height:500px){#mobileActions{grid-template-columns:repeat(4,50px)}#mobileActions button{min-height:42px}}`;
  document.head.appendChild(css);

  const chamber = () => !!window.ICEWALK_CHAMBER?.active;
  const key = (k, on) => document.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: k, bubbles: true }));
  const held = new Set();
  function syncKeys(x, z) {
    const want = new Set();
    if (chamber()) { if (z > 0.3) want.add('w'); if (z < -0.3) want.add('s'); if (x < -0.3) want.add('a'); if (x > 0.3) want.add('d'); }
    for (const k of held) if (!want.has(k)) { key(k, false); held.delete(k); }
    for (const k of want) if (!held.has(k)) { key(k, true); held.add(k); }
  }

  // ---- floating stick
  let pid = null, ox = 0, oy = 0;
  const home = () => { pad.style.left = ''; pad.style.top = ''; pad.style.bottom = ''; };
  function moveStick(e) {
    const r = pad.offsetWidth / 2 || 70;
    let dx = (e.clientX - ox) / r, dy = (e.clientY - oy) / r;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stick.style.transform = `translate(${dx * r * 0.62}px,${dy * r * 0.62}px)`;
    const mag = Math.min(1, m), dead = 0.12, k = mag < dead ? 0 : (mag - dead) / (1 - dead) / (mag || 1);
    IN.x = dx * k; IN.z = -dy * k; IN.active = IN.x !== 0 || IN.z !== 0;
    syncKeys(IN.x, IN.z);
  }
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault(); pid = e.pointerId; zone.setPointerCapture(pid);
    const r = pad.offsetWidth / 2 || 70;
    ox = Math.max(r + 8, Math.min(innerWidth * 0.46 - r, e.clientX)); oy = Math.max(r + 8, Math.min(innerHeight - r - 8, e.clientY));
    pad.style.left = ox - r + 'px'; pad.style.top = oy - r + 'px'; pad.style.bottom = 'auto';
    pad.classList.add('live'); moveStick(e);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === pid) moveStick(e); });
  function endStick(e) {
    if (e && e.pointerId !== pid) return;
    pid = null; IN.active = false; IN.x = IN.z = 0; stick.style.transform = ''; pad.classList.remove('live'); home(); syncKeys(0, 0);
  }
  zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);

  // ---- look
  let lid = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => {
    e.preventDefault(); lid = e.pointerId; look.setPointerCapture(lid); lx = e.clientX; ly = e.clientY;
    if (chamber()) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: lx, clientY: ly }));
      document.getElementById('hcWorld')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: lx, clientY: ly }));
    }
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    if (chamber()) { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: lx, clientY: ly })); return; }
    // slight acceleration for fast flicks, precise for small corrections
    const acc = 1 + Math.min(1.2, Math.hypot(dx, dy) / 40);
    IN.dyaw += dx * 0.0042 * IN.sens * acc; IN.dpitch += dy * 0.0034 * IN.sens * acc;
  });
  function endLook(e) {
    if (e && e.pointerId !== lid) return;
    lid = null; window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook);

  // ---- buttons
  document.querySelectorAll('#mobileActions button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); b.setPointerCapture(e.pointerId); key(b.dataset.key, true);
      if (b.dataset.key === 'Shift') IN.run = true;
      if (!b.dataset.hold) key(b.dataset.key, false);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, () => { if (b.dataset.hold) { key(b.dataset.key, false); if (b.dataset.key === 'Shift') IN.run = false; } });
  });
  const eBtn = document.querySelector('#mobileActions button[data-key="e"]'), hint = document.getElementById('interactHint');
  setInterval(() => { if (eBtn && hint) eBtn.classList.toggle('ready', hint.classList.contains('show')); }, 200);

  function release() { endStick(); endLook(); key('Shift', false); IN.run = false; IN.dyaw = IN.dpitch = 0; }
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
})();
