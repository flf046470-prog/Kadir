/* ANTARKTIKA // WHITEOUT — performance overlay for device testing.
 * Enable with ?perf=1 (or localStorage antarktikaPerf=1, or a triple tap on the
 * compass). Shows FPS, frame-time p95, WebGL draw calls and triangles per frame,
 * the A3D layer's own draws/lights/culling, quality level and texture memory.
 * Rolling numbers are mirrored to window.ANTARKTIKA_PERF for automated tests. */
(() => {
  'use strict';
  let enabled = /[?&]perf=1/.test(location.search);
  try { enabled = enabled || localStorage.getItem('antarktikaPerf') === '1'; } catch (_) { /* ignore */ }
  const canvas = document.getElementById('world');
  const gl = canvas && canvas.getContext('webgl');
  const P = (window.ANTARKTIKA_PERF = { fps: 0, ms: 0, p95: 0, draws: 0, tris: 0, samples: [] });
  let draws = 0, tris = 0;
  if (gl) {
    const da = gl.drawArrays.bind(gl), de = gl.drawElements.bind(gl);
    gl.drawArrays = (mode, first, count) => { draws++; if (mode === gl.TRIANGLES) tris += count / 3; return da(mode, first, count); };
    gl.drawElements = (mode, count, type, off) => { draws++; if (mode === gl.TRIANGLES) tris += count / 3; return de(mode, count, type, off); };
  }
  const box = document.createElement('pre');
  box.id = 'perfOverlay';
  box.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));bottom:8px;z-index:30000;margin:0;padding:8px 10px;background:#02121bd9;color:#aef4ff;font:11px/1.45 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre;border:1px solid #4fc3d655;display:none';
  document.body.appendChild(box);
  const show = (on) => { enabled = on; box.style.display = on ? 'block' : 'none'; try { localStorage.setItem('antarktikaPerf', on ? '1' : '0'); } catch (_) { /* ignore */ } };
  show(enabled);
  let taps = [];
  document.getElementById('compass')?.addEventListener('pointerdown', () => { const t = performance.now(); taps = taps.filter((x) => t - x < 700); taps.push(t); if (taps.length >= 3) { taps = []; show(!enabled); } });

  let last = performance.now(), acc = 0, n = 0;
  const win = [];
  function frame(now) {
    const dt = now - last; last = now;
    win.push(dt); if (win.length > 120) win.shift();
    P.draws = draws; P.tris = Math.round(tris); draws = 0; tris = 0;
    acc += dt; n++;
    if (acc > 500) {
      P.fps = Math.round((n * 1000) / acc); P.ms = +(acc / n).toFixed(1);
      const s = [...win].sort((a, b) => a - b); P.p95 = +s[Math.floor(s.length * 0.95)].toFixed(1);
      P.samples.push({ t: Math.round(now), fps: P.fps, ms: P.ms, p95: P.p95, draws: P.draws, tris: P.tris }); if (P.samples.length > 600) P.samples.shift();
      acc = 0; n = 0;
      if (enabled) {
        const A = window.ANTARKTIKA3D, d = window.ICEWALK_DIAGNOSTICS?.();
        box.textContent = `FPS ${P.fps}  ${P.ms} ms  p95 ${P.p95} ms\nWebGL draw ${P.draws}  üçgen ${P.tris.toLocaleString('tr-TR')}\n` +
          (A ? `A3D ${A.status}  draw ${A.stats.draws}  ışık ${A.stats.lights}  ayıklanan ${A.stats.culled}\nbölge ${A.zone || '-'}  doku ${(A.texBytes / 1048576 || 0).toFixed(1)} MB  yükleme ${A.loadMs} ms\n` : '') +
          `kalite ${window.ICEWALK_VISUALS?.quality}  çözünürlük ${canvas.width}x${canvas.height}  dpr ${devicePixelRatio}\n` +
          (d ? `konum ${d.position.join(', ')}  görev ${d.mission}` : '');
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
