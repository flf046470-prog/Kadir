// Lists every Turkish string the game can show, for translators: node tools/i18n_keys.mjs > i18n/source.json
// Sources: string literals in the game script (minus code), tf() template keys, and the text of the HTML screens.
import fs from 'fs';
const src = fs.readFileSync(new URL('../game.html', import.meta.url), 'utf8');
const js = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1'); // drop line comments: an apostrophe in one would throw the quote scan out of step

const body = src.slice(src.indexOf('<canvas id="view"'), src.indexOf('<script type="importmap">'));
const keys = new Set();
const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const CODE = /^[#.\[>]|px\b|rgba?\(|VT323|Plex|Georgia|sans-serif|monospace|=>|\bfunction\b|\.(js|png|glb|json)\b|^(bad save|bad choice|evidence saved|no longer sleeps|opacity .*|endingFor.*|\(pointer.*)$|^(Key|Arrow|Shift|Control)|^(Tab|Escape|Space|pt-BR|zh-CN)$|^image\/|^[a-z]+[:.\[]|\)\.[a-zA-Z_]|^button\.|^(FX|YXZ|HRTF)$/;
// local signage stays in its own language (Russian, French); Turkish labels the player acts on are translated, and so do the language names
const KEEP = new Set(['AKTARIM · PLM-01', 'PALIMPSESTE · RELAIS PLM-01 · AKTARIM: PARİS', 'NEVŞEHİR', 'SIFIR-17 · KOLA', 'SAKARYA',
  'ARRÊTE ! C\'EST ICI', 'L\'EMPIRE DE LA MORT', 'OSSEMENTS', 'DU CIMETIÈRE', 'DES INNOCENTS', 'RUE DAREAU', 'PROJET PALIMPSESTE — ACCÈS RESTREINT', 'ОБЪЕКТ НОЛЬ-17',
  'Türkçe', 'English', 'Deutsch', 'Français', 'Español', 'Português (Brasil)', 'Русский', '简体中文', '日本語', '한국어', 'YANKI', 'SIFIR-17']);
const SIGN = /^[0-9]+ Hz$/;
for (let m; (m = re.exec(js));) {
  if (m[3] !== undefined && /\$\{/.test(m[3])) continue;
  let s = (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"');
  for (const part of s.split(/<[^>]+>/)) {
    const p = part.trim();
    if (!/[a-zçğıöşüâîûéèA-ZÇĞİÖŞÜ]{2}/.test(p) || CODE.test(p) || KEEP.has(p) || SIGN.test(p)) continue;
    if (/^[a-z][A-Za-z0-9]*$/.test(p) || /^[a-z-]+(\s[a-z-]+)*$/.test(p) && !/[çğıöşü]/.test(p) && p.split(' ').length < 3) continue; // identifiers, css keywords
    keys.add(p);
  }
}
for (const m of js.matchAll(/tf\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
for (const m of body.matchAll(/>([^<>]+)</g)) { const p = m[1].trim(); if (/[a-zçğıöşüA-ZÇĞİÖŞÜ]{2}/.test(p)) keys.add(p); }
// strings built at run time that the scan cannot see
for (const k of [...js.matchAll(/'(> [^'>]+)'/g)].map((m) => m[1])) keys.add(k); // monitor lines
for (const k of ['PARİS', 'Çarkı çevir', 'AKTARIM', 'AKTARIM: PARİS', 'kilitli', 'Aç', 'emin misin? Tekrar E', 'KANIT ARŞİVİ', 'Kararlar', 'Kırık mühürler', 'Kanıt eklendi', 'Mühür kırıldı', 'hayatta', 'kayıp', 'adı seninle', 'kayıtta', 'uyutuldu', 'serbest', 'yanında', 'kapının ardında', 'SON']) keys.add(k);
// short labels that need no translation: names, places, code words on in-world signs
for (const k of ['Ekin', 'Camille', 'Deniz', 'Élise', 'Volkova', 'Deniz?', 'Sakarya', 'Nevşehir', 'Paris', 'Dr. Camille Moreau', 'Deniz Arat', 'DERİNLİK', 'THE DEPTHS: ECHOES OF THE FORGOTTEN', 'AUTO · NIGHTSHOT', 'REC 00:00:00', '02:51:00', 'SAKARYA · 2028', 'W A S D · Fare'].filter((k) => k !== 'W A S D · Fare')) keys.delete(k);
console.log(JSON.stringify([...keys], null, 1));
