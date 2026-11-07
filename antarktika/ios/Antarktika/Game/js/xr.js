/* ANTARKTIKA // WHITEOUT — VR (WebXR immersive-vr).
 *
 * Same world, same story, same saves; renders the existing ICEWALK engine in
 * stereo through WebXR. Targets Meta Quest Browser and Apple Vision Pro Safari
 * (immersive-vr). Not used by the iOS app (WKWebView on iPhone has no WebXR):
 * the button only appears when navigator.xr reports immersive-vr support.
 *
 * Controls (xr-standard gamepad mapping)
 *   left stick   walk (head-relative)      left grip   run
 *   right stick  snap turn 30°              right trigger  interact (E)
 *   A            scan (Q)                   B            flashlight (F)
 *   X            journal toast (last entry) Y            recentre
 * Comfort: snap turning, a soft vignette while moving, fade to black when the
 * head is pushed into a wall (no seeing through geometry).
 */
(() => {
  'use strict';
  const X = (window.ANTARKTIKA_XR = { active: false, supported: false, session: null, stats: { frames: 0, views: 0 } });
  const canvas = document.getElementById('world');
  const gl = canvas && canvas.getContext('webgl');
  if (!gl || !navigator.xr) return;

  let refSpace = null, snapYaw = 0, lastT = 0, turnLatch = false, buttonsPrev = {}, hudTex = null, hudCanvas = null, hudCtx = null, hudAt = 0;
  let quad = null, toastText = '', toastUntil = 0, fade = 0;

  /* ---------------------------------------------------------------- tiny matrix helpers (column-major) */
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const trans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  function invRigid(m) {   // inverse of rotation + translation
    const o = new Float32Array(16);
    o[0] = m[0]; o[1] = m[4]; o[2] = m[8]; o[4] = m[1]; o[5] = m[5]; o[6] = m[9]; o[8] = m[2]; o[9] = m[6]; o[10] = m[10];
    o[12] = -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]);
    o[13] = -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]);
    o[14] = -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]);
    o[15] = 1; return o;
  }

  /* ---------------------------------------------------------------- in-world HUD (wrist panel + toast) */
  function hudProgram() {
    if (quad) return quad;
    const vs = 'attribute vec3 aP;attribute vec2 aT;uniform mat4 uM,uV,uP;varying vec2 vT;void main(){vT=aT;gl_Position=uP*uV*uM*vec4(aP,1.);}';
    const fs = 'precision mediump float;varying vec2 vT;uniform sampler2D uTex;uniform float uA;void main(){vec4 c=texture2D(uTex,vT);gl_FragColor=vec4(c.rgb,c.a*uA);}';
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.25, 0, 0, 1, 0.5, -0.25, 0, 1, 1, 0.5, 0.25, 0, 1, 0, -0.5, -0.25, 0, 0, 1, 0.5, 0.25, 0, 1, 0, -0.5, 0.25, 0, 0, 0]), gl.STATIC_DRAW);
    quad = { p, b, aP: gl.getAttribLocation(p, 'aP'), aT: gl.getAttribLocation(p, 'aT'), uM: gl.getUniformLocation(p, 'uM'), uV: gl.getUniformLocation(p, 'uV'), uP: gl.getUniformLocation(p, 'uP'), uTex: gl.getUniformLocation(p, 'uTex'), uA: gl.getUniformLocation(p, 'uA') };
    hudCanvas = document.createElement('canvas'); hudCanvas.width = 512; hudCanvas.height = 256; hudCtx = hudCanvas.getContext('2d');
    hudTex = gl.createTexture();
    return quad;
  }
  function paintHud(now) {
    hudProgram();   // creates the HUD canvas/texture on the first XR frame
    if (now - hudAt < 200) return; hudAt = now;
    const d = window.ICEWALK_DIAGNOSTICS?.(); if (!d) return;
    const c = hudCtx || (hudCtx = hudCanvas && hudCanvas.getContext('2d')), $ = (id) => document.getElementById(id)?.textContent || '';
    if (!c) return;
    c.clearRect(0, 0, 512, 256);
    c.fillStyle = 'rgba(4,24,34,0.82)'; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = 'rgba(160,230,240,0.5)'; c.lineWidth = 3; c.strokeRect(2, 2, 508, 252);
    c.fillStyle = '#ffc292'; c.font = 'bold 26px system-ui,sans-serif'; c.fillText($('missionName').slice(0, 30), 18, 44);
    c.fillStyle = '#e8fbff'; c.font = 'bold 40px system-ui,sans-serif'; c.fillText($('distance'), 18, 96);
    c.font = '20px system-ui,sans-serif'; c.fillStyle = '#bfe3ea'; c.fillText($('temperature') + '   TİPİ ' + $('stormVal'), 200, 92);
    const bar = (y, label, val, col) => { c.fillStyle = '#9cc'; c.fillText(label, 18, y); c.fillStyle = 'rgba(80,110,120,0.6)'; c.fillRect(170, y - 16, 320, 14); c.fillStyle = col; c.fillRect(170, y - 16, 3.2 * val, 14); };
    bar(140, 'VÜCUT ISISI', parseFloat($('warmthVal')) || 0, '#ffc37e');
    bar(172, 'DAYANIKLILIK', parseFloat($('staminaVal')) || 0, '#e5f9ff');
    const hint = document.getElementById('interactHint');
    if (hint && hint.classList.contains('show')) { c.fillStyle = '#f5e9ce'; c.font = 'bold 22px system-ui,sans-serif'; c.fillText('TETİK · ' + hint.textContent.replace(/^E\s*/, ''), 18, 228); }
    gl.bindTexture(gl.TEXTURE_2D, hudTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hudCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  // toast panel: separate small canvas texture
  let toastTex = null, toastCanvas = null, toastShown = '';
  function paintToast() {
    const n = document.getElementById('notice'), txt = n && n.classList.contains('show') ? n.textContent : '';
    if (txt && txt !== toastShown) { toastShown = txt; toastText = txt; toastUntil = performance.now() + 4200; }
    if (!toastTex) { toastTex = gl.createTexture(); toastCanvas = document.createElement('canvas'); toastCanvas.width = 1024; toastCanvas.height = 128; }
    const c = toastCanvas.getContext('2d'); if (!c) return;
    c.clearRect(0, 0, 1024, 128);
    if (performance.now() < toastUntil) {
      c.fillStyle = 'rgba(7,27,41,0.9)'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#87f6f1'; c.fillRect(0, 0, 8, 128);
      c.fillStyle = '#eaf9ff'; c.font = 'bold 30px system-ui,sans-serif';
      const words = toastText.split(' '); let line = '', y = 50;
      for (const w of words) { if (c.measureText(line + w).width > 960) { c.fillText(line, 28, y); line = ''; y += 40; } line += w + ' '; }
      c.fillText(line, 28, y);
    }
    gl.bindTexture(gl.TEXTURE_2D, toastTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toastCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function drawQuad(tex, model, view, proj, alpha) {
    const q = hudProgram();
    gl.useProgram(q.p); gl.bindBuffer(gl.ARRAY_BUFFER, q.b);
    gl.enableVertexAttribArray(q.aP); gl.vertexAttribPointer(q.aP, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(q.aT); gl.vertexAttribPointer(q.aT, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(q.uM, false, model); gl.uniformMatrix4fv(q.uV, false, view); gl.uniformMatrix4fv(q.uP, false, proj);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(q.uTex, 6); gl.uniform1f(q.uA, alpha);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(q.aP); gl.disableVertexAttribArray(q.aT); gl.activeTexture(gl.TEXTURE0);
  }

  /* ---------------------------------------------------------------- input */
  const key = (k, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: k, bubbles: true }));
  function readInput(frame, body) {
    const IN = window.ICEWALK_INPUT || (window.ICEWALK_INPUT = { active: false, x: 0, z: 0, run: false, dyaw: 0, dpitch: 0, sens: 1 });
    IN.active = false; IN.x = IN.z = 0; IN.run = false;
    const hands = {};
    for (const src of X.session.inputSources) {
      const gp = src.gamepad, side = src.handedness;
      if (src.gripSpace || src.targetRaySpace) {
        const pose = frame.getPose(src.gripSpace || src.targetRaySpace, refSpace);
        if (pose) hands[side] = mul(body, pose.transform.matrix);
      }
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
      const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i) => { const k = side + i, now = pressed(i), was = buttonsPrev[k]; buttonsPrev[k] = now; return now && !was; };
      if (side === 'left') {
        if (Math.hypot(ax[0], ax[1]) > 0.15) { IN.active = true; IN.x = ax[0]; IN.z = -ax[1]; }
        IN.run = pressed(1);
        if (edge(4)) { const e = [...document.querySelectorAll('#journalEntries article')].pop(); if (e) { toastText = e.textContent.slice(0, 220); toastUntil = performance.now() + 7000; } }
        if (edge(5)) recentre = true;
      } else if (side === 'right') {
        if (Math.abs(ax[0]) > 0.7 && !turnLatch) { snapYaw += ax[0] > 0 ? Math.PI / 6 : -Math.PI / 6; turnLatch = true; }
        if (Math.abs(ax[0]) < 0.3) turnLatch = false;
        if (edge(0)) { key('e', true); key('e', false); }
        if (edge(4)) { key('q', true); key('q', false); }
        if (edge(5)) { key('f', true); key('f', false); }
      }
    }
    return hands;
  }
  let recentre = false;

  /* ---------------------------------------------------------------- frame */
  function onFrame(t, frame) {
    const s = frame.session; s.requestAnimationFrame(onFrame);
    const E = window.ICEWALK_ENGINE, A = window.ANTARKTIKA3D; if (!E) return;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 1 / 72); lastT = t;
    const pose = frame.getViewerPose(refSpace); if (!pose) return;
    const layer = s.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    const p = E.player;
    // body transform: player position on the ground, snap-turned; room-scale head offset rides on top
    const ground = A ? A.groundY(p.x, p.z) : 0;
    let body = mul(trans(p.x, ground, p.z), rotY(-snapYaw));
    const hands = readInput(frame, body);
    // head-relative locomotion: the engine walks along player.yaw
    const hm = mul(body, pose.transform.matrix), hf = [-hm[8], -hm[9], -hm[10]];
    p.yaw = Math.atan2(hf[0], -hf[2]); p.pitch = Math.asin(Math.max(-1, Math.min(1, hf[1])));
    if (recentre) { recentre = false; snapYaw = 0; }
    // comfort: fade when the head enters solid geometry
    const solid = A && A.ready && A.collide(hm[12], hm[14], hm[12], hm[14], 0.12);
    const inWall = solid && Math.hypot(solid[0] - hm[12], solid[1] - hm[14]) > 0.02;
    fade += ((inWall ? 1 : 0) - fade) * Math.min(1, dt * 10);
    E.step(dt, 1);
    paintHud(t); paintToast();
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const eyeM = mul(body, view.transform.matrix);
      const viewM = invRigid(eyeM), proj = view.projectionMatrix;
      const cam = {
        eye: [eyeM[12], eyeM[13], eyeM[14]], r: [eyeM[0], eyeM[1], eyeM[2]], u: [eyeM[4], eyeM[5], eyeM[6]], f: [-eyeM[8], -eyeM[9], -eyeM[10]],
        view: viewM, proj, aspect: vp.width / vp.height, tan: 1 / proj[5],
        xr: { hands, torch: hands.right ? { p: [hands.right[12], hands.right[13], hands.right[14]], d: [-hands.right[8], -hands.right[9], -hands.right[10]] } : null },
      };
      E.renderView(cam);
      // wrist panel on the left controller, toast 1.4 m ahead at eye height
      if (hands.left) drawQuad(hudTex, mul(hands.left, mul(trans(0, 0.06, 0.05), new Float32Array([0.22, 0, 0, 0, 0, 0, -0.22, 0, 0, 0.22, 0, 0, 0, 0, 0, 1]))), viewM, proj, 0.95);
      if (performance.now() < toastUntil) {
        const yaw = Math.atan2(hf[0], -hf[2]);
        const tm = mul(trans(hm[12] + Math.sin(yaw) * 1.4, hm[13] - 0.15, hm[14] - Math.cos(yaw) * 1.4), mul(rotY(-yaw), new Float32Array([1.2, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])));
        drawQuad(toastTex, tm, viewM, proj, 0.96);
      }
      if (fade > 0.02) { gl.enable(gl.SCISSOR_TEST); gl.scissor(vp.x, vp.y, vp.width, vp.height); gl.clearColor(0, 0, 0, 1); if (fade > 0.6) gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST); }
      X.stats.views++;
    }
    X.stats.frames++;
  }

  /* ---------------------------------------------------------------- session */
  async function enter() {
    if (X.active) return;
    const E = window.ICEWALK_ENGINE;
    if (E && E.state !== 'play') document.getElementById(document.getElementById('continueBtn') && !document.getElementById('continueBtn').hidden ? 'continueBtn' : 'startBtn')?.click();
    if (gl.makeXRCompatible) await gl.makeXRCompatible();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    X.session = session; X.active = true; lastT = 0; snapYaw = 0;
    document.body.classList.add('xr-live');
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { antialias: true }), depthNear: 0.05, depthFar: 900 });
    try { refSpace = await session.requestReferenceSpace('local-floor'); } catch (_) { refSpace = await session.requestReferenceSpace('local'); }
    session.addEventListener('end', () => { X.active = false; X.session = null; document.body.classList.remove('xr-live'); gl.bindFramebuffer(gl.FRAMEBUFFER, null); window.ICEWALK_INPUT && (window.ICEWALK_INPUT.active = false); window.ANTARKTIKA_SAVE?.save('xr-exit'); });
    session.requestAnimationFrame(onFrame);
  }
  X.enter = enter;
  X.exit = () => X.session && X.session.end();

  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    X.supported = ok; if (!ok) return;
    const b = document.createElement('button');
    b.id = 'vrBtn'; b.type = 'button'; b.textContent = 'VR MODU · BAŞLIK TAK';
    b.style.cssText = 'display:block;margin:12px auto 0;padding:14px 22px;border:1px solid #b6f4ffaa;background:#0b3446e6;color:#dffaff;font:800 12px system-ui;letter-spacing:2px;cursor:pointer';
    b.addEventListener('click', () => enter().catch((e) => { console.warn('WebXR', e); b.textContent = 'VR BAŞLATILAMADI'; }));
    const anchor = document.getElementById('qualityBtn') || document.getElementById('startBtn');
    anchor.insertAdjacentElement('afterend', b);
  }).catch(() => {});
})();
