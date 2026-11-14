/* ================================================================ DERİNLİK II — 78° GÜNEY
   Inserted into the first game's core by DerinlikII/make.py, ahead of its chapter registry. Everything the core offers
   (room, box, Door, bulb, note, zone, camTarget, confirmChoice, say, sfx…) is used as is; only story and levels are new. */
FX.frost = true;   // fx-materials: rime frost on painted walls, tiles and metal in every chapter
// procedural fallbacks for the new surfaces (the baked PBR sets 'snow' and 'ice' replace them through fx-materials)
Object.assign(SURF, { snow: [[.86, .89, .93], 4, .12, 181], ice: [[.55, .68, .78], 3, .18, 193] });

// The world the first game left behind (DerinlikWeb game.html ending(): derinlik.legacy.v1). No legacy: the quiet default.
// read when a chapter is built (ENDINGS is declared further down the core, so not at load time)
function legacy() {
  try { const l = JSON.parse(localStorage.getItem('derinlik.legacy.v1') || 'null'); return l && ENDINGS[l.ending] ? l : null; } catch (_) { return null; }
}

Object.assign(EVIDENCE, {
  stationLog: { cat: 'Belgeler', title: 'Kerguelen-78 nöbet defteri', text: '2 Mart — Sondaj 3.712 m. Matkap boşluğa düştü. Kuyudan sıcak hava geliyor. 3 Mart — Telsizde kendi seslerimizi duyuyoruz, bir gün gecikmeli. 4 Mart — Yakıt bitiyor. Ya jeneratör ya asansör. Hartmann aşağı inmek istiyor.' },
  whiteout: { cat: 'Kayıtlar', title: 'Fırtınadaki figür', text: 'Halat boyunca, kar perdesinin içinde biri duruyordu. Yalnızca vizörde. Kar onun üstüne yağmıyordu.' },
  hartmann: { cat: 'Kayıtlar', title: 'Sondaj şefi Hartmann', text: 'Jeneratör salonunun köşesinde, yüzü duvara dönük, ayakta donmuş. Cebinde KAYIT 00\'ın aslı: 03:17, 78° G.' },
});
CHOICES.fuel = ['generator', 'lift'];
CHOICE_TEXT.fuel = { generator: 'İstasyon: son yakıt jeneratöre. Işıklar ve telsiz açık.', lift: 'İstasyon: son yakıt asansöre. İstasyon karanlıkta kaldı.' };

// who answers the station radio, by the first game's ending
function radioLines() {
  const l = legacy(); switch (l && l.ending) {
    case 'tanik': return [['Deniz (telsiz)', 'Ekin? Sesin geliyor. Ben kıyıdaki gemideyim.', 3000], ['Deniz (telsiz)', 'Kuyuya inersen kamerayı kapatma. Ben buradan izliyorum.', 3600]];
    case 'eve': return [['Camille (telsiz)', 'Ekin… buradayım. Kapının öbür yanında.', 3000], ['Camille (telsiz)', 'Aşağıdan sesleniyorum. Élise iyi mi?', 3000]];
    case 'geri': return [['Élise (telsiz)', 'Annem burada değil.', 2400], ['Élise (telsiz)', 'Aşağı gel. Hep birlikte bekliyoruz.', 3000]];
    case 'bekci': return [['??? (telsiz)', 'Ekin Yalın içeride kalmıştı.', 2800], ['??? (telsiz)', 'O hâlde kapıdan çıkan kim?', 2600]];
    case 'unutulan': return [['Operatör (telsiz)', 'Kerguelen-78, kimsiniz? Bu istasyonun listesinde adınız yok.', 3800]];
    case 'yeni': case 'kanit': return [['Hükümet kanalı', 'Kerguelen-78 karantinada. Kuyuya iniş yasaktır.', 3400], ['Ekin', 'Benden önce gelmişler.', 2200]];
    default: return [['İkinci Ses', 'Hoş geldin. Kapıları kapattığını sanmıştın.', 3200]];
  }
}

function sliceEnd() {
  if (state.ended) return;
  state.ended = true; player.enabled = false; if (state.camRaised) toggleCam();
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
  $('fade').style.opacity = '1'; $('hud').hidden = true; $('touch').hidden = true; try { document.exitPointerLock(); } catch (_) {}
  sfx.rumble(null, 3);
  later(2600, () => {
    $('endEyebrow').textContent = t('BÖLÜM 1 SONU'); $('endTitle').textContent = 'DERİNLİK II';
    $('endText').textContent = t(state.choices.fuel === 'lift'
      ? 'Asansör karanlıkta hızla indi. Yukarıda istasyonun son ışığı söndü; telsizden kimse sana seslenemeyecek. Kuyu 3.712 metre derinde bir boşluğa açılıyor.'
      : 'Asansör jeneratörün son nefesiyle, yavaşça indi. Telsiz hâlâ açık; yukarıda biri seni dinliyor. Kuyu 3.712 metre derinde bir boşluğa açılıyor.');
    $('endStats').textContent = t('Bölüm 2 · KUYU yapım aşamasında.') + (legacy() ? ` · ${t('Önceki son')}: ${t(ENDINGS[legacy().ending][1])}` : '');
    showTape(); $('end').hidden = false;
  });
}

/* ================================================================ CHAPTER 1 — KERGUELEN-78: İSTASYON */
function buildIstasyon() {
  // 01 Hut A (arrival / airlock): x -3..3, z 0..7; the airlock door in the north wall
  room(-3, 3, 0, 7, 2.5, M.soviet, { floor: M.metal, n: [{ c: 0, w: 1, h: 2.1 }] });
  new Door(-.5, 7.1, 1, 2.1, { mat: M.metal, name: 'Hava kilidi' });
  for (const z of [.4, 2.4]) { box([-2.95, 0, z], [-2.05, .45, z + 1.8], M.metal); box([-2.95, 1.25, z], [-2.05, 1.3, z + 1.8], M.metal); }
  box([1.4, .74, 2.6], [2.6, .78, 3.8], M.wood); for (const x of [1.44, 2.52]) for (const z of [2.64, 3.72]) box([x, 0, z], [x + .04, .74, z + .04], M.metal, { tile: .5 });
  note(paper([2.0, .785, 3.1], .2), 'stationLog');
  prop('radio', [1.7, .78, 3.55], .3);
  prop('chair', [1.9, 0, 4.3], 3.0, { collide: true });
  const hutLamp = bulb([0, 2.25, 3.5], 0xc8d8ff, 1.4, 7);
  decal(textTexture(['KERGUELEN-78', 'SONDAJ İSTASYONU · 78° G'], { font: '60px VT323, monospace', fg: '#d8dde4' }), 1.4, .5, [0, 1.75, 6.97], Math.PI);

  // 02 Outside: the rope line through the blizzard, z 7.2..22; snow banks fence it, cold drives you on
  const ground = box([-6, -.1, 7.2], [6, 0, 22], M.snow); ground.userData.surface = 'floor';
  box([-6, 0, 7.2], [-4.6, 1.6, 22], M.snow); box([4.6, 0, 7.2], [6, 1.6, 22], M.snow);
  for (let z = 8; z <= 21; z += 2.2) box([-.86, 0, z], [-.8, 1.1, z + .06], M.metal, { tile: .4 });
  box([-.845, 1.0, 8], [-.815, 1.03, 21.06], M.rust, { collide: false, cast: false });
  box([-1.6, 0, 13.1], [.4, 1.9, 14.7], M.rust); box([-1.7, 1.9, 13], [.5, 1.98, 14.8], M.snow, { collide: false });   // a half-buried container
  // the figure in the snow: only the raised camcorder sees it, and the snow does not fall on it
  const ghost = makeFigure({ coat: M.dark, h: 1.85, eyes: false }); ghost.position.set(3.4, 0, 17.6); ghost.rotation.y = -Math.PI / 2; W.group.add(ghost);
  onlyThroughCamera(ghost);
  camTarget(hitPlane(.8, 1.9, [3.4, .95, 17.6], -Math.PI / 2), 1.2, () => { addEvidence('whiteout'); raiseEcho(); sfx.static(.6, .12); say([['Ekin', 'Biri var… kar üstüne yağmıyor.', 2600]]); });
  // the storm thickens outside and lifts indoors; out in the open the cold counts down
  let cold = 0, warned = 0;
  W.updaters.push((dt) => {
    const out = player.z > 7.3 && player.z < 21.9;
    const fd = out ? .2 : .06; scene.fog.density += (fd - scene.fog.density) * Math.min(1, dt * 1.5);
    if (state.transit || state.ended) return;
    cold = out ? cold + dt : Math.max(0, cold - dt * 3);
    if (cold > 18 && warned < 1) { warned = 1; toast('Parmakların hissizleşiyor. Jeneratör salonuna yetiş.'); }
    if (cold > 30 && warned < 2) { warned = 2; say([['Ekin', 'Nefes… alamıyorum…', 2000]]); }
    if (cold > 40) { cold = 0; warned = 0; respawn('Soğuktan bayıldın. Kulübeye geri sürüklendin.'); }
  });
  zone([-4.6, 0, 7.4], [4.6, 3, 9], () => objective('Halatı izle. Jeneratör salonu kuzeyde. Dışarıda uzun kalma.'));

  // 03 Hut B: the generator hall, Hartmann, the last fuel and the drill lift
  room(-4, 4, 22, 32, 3.2, M.soviet, { floor: M.metal, s: [{ c: 0, w: 1.2, h: 2.2 }] });
  new Door(-.6, 21.9, 1.2, 2.2, { mat: M.metal, name: 'Salon kapısı' });
  box([-3.7, 0, 23.6], [-1.9, 1.4, 27.2], M.rust); box([-3.4, 1.4, 24], [-2.2, 1.8, 26.8], M.metal);   // the generator
  const lamps = [bulb([-2, 2.9, 25], 0xffe2b8, 1.8, 8), bulb([2, 2.9, 28.5], 0xffe2b8, 1.8, 8)];
  for (const b of lamps) b.set(false);
  const emergency = bulb([3.6, 2.6, 22.6], 0xff3a22, .9, 6, { shade: false });
  every(1.6, () => { if (!state.choices.fuel) emergency.set(!emergency.on); });
  const hart = makeFigure({ h: 1.82 }); hart.position.set(3.55, 0, 26.2); hart.rotation.y = -Math.PI / 2; W.group.add(hart);
  addInteract(hitPlane(.6, 1.8, [3.3, .9, 26.2], Math.PI / 2), { prompt: 'Donmuş adama bak', enabled: () => !state.evidence.has('hartmann'), interact() {
    addEvidence('hartmann'); sfx.static(.5, .08);
    say([['Ekin', 'Yüzü duvara dönük… sanki bir şeyi dinliyormuş.', 3000], ['Ekin', 'Cebinde bir kaset: KAYIT 00. Aslı buymuş.', 3000]]);
  } });
  // the drill lift: a cage over the shaft in the north
  for (const [x, z] of [[-1.1, 29.4], [1.1, 29.4], [-1.1, 31.6], [1.1, 31.6]]) box([x - .04, 0, z - .04], [x + .04, 3.2, z + .04], M.rust, { tile: .4 });
  box([-1.1, 0, 29.4], [1.1, .08, 31.6], M.metal, { collide: false });
  const liftMotor = box([1.5, 0, 30.2], [2.3, 1.1, 31.2], M.rust);
  // the last fuel: one drum, two engines
  let carrying = false;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .9, 20), M.rust); drum.position.set(-3.2, .45, 30.8); drum.castShadow = true; W.group.add(drum);
  addInteract(drum, { prompt: 'Son yakıt bidonunu al', enabled: () => !carrying && !state.choices.fuel, interact() {
    carrying = true; drum.visible = false; sfx.rattle({ x: -3.2, y: .5, z: 30.8 });
    objective('Tek bidon. Jeneratör (ışık ve telsiz) ya da asansör motoru (daha hızlı iniş).');
  } });
  const genHit = hitPlane(1.8, 1.4, [-1.88, .8, 25.4], Math.PI / 2);
  const motorHit = hitPlane(1, 1.1, [1.48, .6, 30.7], -Math.PI / 2);
  addInteract(genHit, confirmChoice('fuel', 'Yakıtı jeneratöre dök · ışık ve telsiz', () => { if (choose('fuel', 'generator')) applyFuel('generator', false); }, { tag: 'fuel:g', enabled: () => carrying }));
  addInteract(motorHit, confirmChoice('fuel', 'Yakıtı asansör motoruna dök · daha hızlı iniş', () => { if (choose('fuel', 'lift')) applyFuel('lift', false); }, { tag: 'fuel:l', enabled: () => carrying }));
  let liftReady = false;
  function applyFuel(v, instant) {
    carrying = false; emergency.set(false); liftReady = true;
    if (v === 'generator') {
      for (const b of lamps) b.set(true); hutLamp.set(true);
      if (!instant) { sfx.rumble({ x: -2.8, y: .8, z: 25.4 }, 3); later(1800, () => { sfx.static(.9, .12); say(radioLines()).then(() => objective('Asansör kafesine gir ve inişi başlat.')); }); }
    } else {
      hutLamp.set(false);
      if (!instant) { sfx.rumble({ x: 1.9, y: .6, z: 30.7 }, 2); sfx.whisper(null, 2.2, .25); say([['Ekin', 'Işıklar gitti. Telsiz de.', 2200]]).then(() => objective('Asansör kafesine gir ve inişi başlat.')); }
    }
    if (instant) objective('Asansör kafesine gir ve inişi başlat.');
  }
  box([-1.12, 1.15, 30.3], [-1.02, 1.45, 30.7], M.metal, { collide: false, tile: .3 });   // the lift's control box, on the cage's west post side
  addInteract(hitPlane(.4, .3, [-1.01, 1.3, 30.5], Math.PI / 2), { prompt: 'İnişi başlat', enabled: () => liftReady && !state.ended && Math.abs(player.x) < 1.1 && player.z > 29.4 && player.z < 31.6, interact() {
    sfx.rattle({ x: 0, y: 1, z: 30.5 }); FX.emit('slam', new THREE.Vector3(0, 1, 30.5)); later(state.choices.fuel === 'lift' ? 800 : 2400, sliceEnd);
  } });
  zone([-4, 0, 22.2], [4, 3, 24], () => { if (!state.choices.fuel) objective('Jeneratör sustu. Salonda yakıt olmalı.'); });
  if (state.choices.fuel) { drum.visible = false; applyFuel(state.choices.fuel, true); }
  if (ac) { ambienceWind(240, .09); ambienceHum({ x: -2.8, y: .8, z: 25.4 }, [47, 94], .02); }
  return { spawn: [0, 1.4, Math.PI], fog: [0x4a5260, .06], ambient: [0x9fb2c8, .05], objective: legacy() ? 'Kerguelen-78. KAYIT 00 buradan gönderildi.' : 'Kerguelen-78, 78° Güney. KAYIT 00 buradan gönderildi.' };
}
