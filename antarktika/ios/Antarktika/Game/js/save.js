/* ANTARKTIKA // WHITEOUT — full save system.
 *
 * Saves the whole expedition: player position/vitals, mission, prologue step,
 * journal entries, field-scanner relics, fragile cargo, crew talks, 3D puzzle
 * state (generator, frequency, crystals) and the HELIKON chamber choice.
 *
 * Two stores, newest wins:
 *  - localStorage (browser / fallback)
 *  - the iOS app's native store: posted to webkit.messageHandlers.antarktikaSave,
 *    written atomically to Application Support by Swift, and injected back at
 *    launch as window.__ANTARKTIKA_NATIVE_SAVE__. WebKit may purge website data
 *    under storage pressure; the native file is what survives app restarts.
 *
 * Autosave: every 15 s while playing, on every mission / relic / cargo / puzzle
 * event, on pause, and when the app goes to the background. */
(() => {
  'use strict';
  const KEY = 'antarktika.save.v1';
  const E = () => window.ICEWALK_ENGINE;
  let armedUntil = 0;

  function collect() {
    const e = E(); if (!e) return null;
    let chamber = null;
    try { chamber = localStorage.getItem('antartikaHelikon29'); } catch (_) { /* ignore */ }
    return {
      v: 1, t: Date.now(), engine: e.serialize(),
      prologue: window.ICEWALK_PROLOGUE.serialize(), journal: window.ICEWALK_JOURNAL.serialize(),
      field: window.ICEWALK_FIELD.serialize(), cargo: window.ICEWALK_CARGO.serialize(),
      crew: window.ICEWALK_MESHY.serialize(), a3d: window.ANTARKTIKA3D?.serialize ? window.ANTARKTIKA3D.serialize() : null, chamber,
    };
  }
  const valid = (o) => o && o.v === 1 && o.engine && typeof o.t === 'number';
  function read() {
    let local = null, native = null;
    try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { local = null; }
    try { native = window.__ANTARKTIKA_NATIVE_SAVE__ ? JSON.parse(window.__ANTARKTIKA_NATIVE_SAVE__) : null; } catch (_) { native = null; }
    return [local, native].filter(valid).sort((a, b) => b.t - a.t)[0] || null;
  }
  function post(json) { try { window.webkit?.messageHandlers?.antarktikaSave?.postMessage(json); } catch (_) { /* not in the app */ } }
  function save(why) {
    const e = E(); if (!e) return false;
    if (!['play', 'paused', 'journal', 'chapter'].includes(e.state)) return false;
    const o = collect(); if (!o) return false;
    o.why = why || 'auto';
    const json = JSON.stringify(o);
    try { localStorage.setItem(KEY, json); } catch (_) { /* quota / private mode: native store still works */ }
    post(json);
    window.__ANTARKTIKA_NATIVE_SAVE__ = json;
    return true;
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
    post('');
    window.__ANTARKTIKA_NATIVE_SAVE__ = null;
    refreshMenu();
  }
  function load() {
    const o = read(); if (!o) return false;
    E().continueFrom(o.engine, () => {
      window.ICEWALK_PROLOGUE.restore(o.prologue);
      window.ICEWALK_JOURNAL.restore(o.journal);
      window.ICEWALK_FIELD.restore(o.field);
      window.ICEWALK_CARGO.restore(o.cargo);
      window.ICEWALK_MESHY.restore(o.crew);
      window.ANTARKTIKA3D?.restore(o.a3d);
      if (o.chamber) { try { localStorage.setItem('antartikaHelikon29', o.chamber); } catch (_) { /* ignore */ } }
    });
    return true;
  }
  function label(o) {
    const e = o.engine, mins = Math.max(1, Math.round((e.elapsed || 0) / 60));
    const what = o.prologue && o.prologue.active ? 'PROLOGUE ' + ((o.prologue.stage | 0) + 1) + '/4' : E().missionTitle(e.mission | 0);
    return what + ' · ' + mins + ' dk';
  }

  // ---- menu: continue button, new-game confirmation, asset loading status
  const startBtn = document.getElementById('startBtn');
  const cont = document.createElement('button');
  cont.id = 'continueBtn'; cont.type = 'button'; cont.hidden = true;
  startBtn.parentNode.insertBefore(cont, startBtn);
  const st = document.createElement('style');
  st.textContent = '#continueBtn{display:block;margin:0 0 12px;padding:18px 30px;background:#ffc58f;color:#1b2430;font-weight:950;font-size:13px;letter-spacing:2.4px;border:0;border-radius:2px;box-shadow:0 0 40px #ffc58f40;cursor:pointer;max-width:92vw}#continueBtn[hidden]{display:none}';
  document.head.appendChild(st);
  cont.addEventListener('click', () => { if (!load()) refreshMenu(); });
  startBtn.addEventListener('click', (ev) => {
    const s = E()?.state;
    if ((s === 'menu' || s === 'won') && read() && Date.now() > armedUntil) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      armedUntil = Date.now() + 4000;
      startBtn.textContent = 'EMİN MİSİN? KAYIT SİLİNİR · YENİ SEFER';
      setTimeout(refreshMenu, 4100);
    }
  }, true);
  function refreshMenu() {
    const e = E(); if (!e) return;
    const o = read(), show = !!o && (e.state === 'menu' || e.state === 'won');
    cont.hidden = !show;
    if (show) { cont.textContent = 'DEVAM ET · ' + label(o); if (Date.now() > armedUntil) startBtn.textContent = 'YENİ SEFER ↗'; }
  }
  const footer = document.getElementById('footer'), footerText = footer ? footer.textContent : '';
  function assetStatus() {
    const A = window.ANTARKTIKA3D; if (!footer || !A) return;
    if (A.status === 'loading') footer.textContent = '3D DÜNYA YÜKLENİYOR · %' + Math.round(A.progress * 100);
    else if (A.status === 'ready') footer.textContent = footerText;
    else if (A.status === 'failed') footer.textContent = footerText + ' · 3D MODELLER YÜKLENEMEDİ';
  }
  refreshMenu();
  let lastState = null;
  setInterval(() => {
    const s = E()?.state;
    if (s !== lastState) { lastState = s; refreshMenu(); }
    assetStatus();
  }, 400);
  setInterval(() => { if (E()?.state === 'play') save('auto'); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save('hidden'); });
  window.addEventListener('pagehide', () => save('pagehide'));

  window.ANTARKTIKA_SAVE = {
    save, clear, load, read, collect,
    summary() { const o = read(); return o ? { t: o.t, mission: o.engine.mission, prologue: o.prologue, why: o.why } : null; },
  };
})();
