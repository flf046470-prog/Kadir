# Hikâyenin devamı — Bölüm 2–4 senaryo planı

Mevcut dikey dilim (istasyon, jeneratör, 3.17 MHz, buz mağarası, A1 çekirdeği) **Bölüm 1**'dir.

## Bölüm 2 · "Gelecekten Yayın"
- Kanca: 3.17 MHz yayını 72 saat sonrasından geliyor; konuşan oyuncunun kendi sesi.
- Mekân: verici direği + kara kutunun düştüğü buzul yarığı (orijinal oyundaki 6 görevin verici/kara kutu bölgesi).
- Bulmaca: kara kutu kaydını 4 parçadan birleştirme (tarayıcı Q ile parça bulunur, telsizde sıraya dizilir).
- Dönüm: Dr. Selin'in sesi, onun "geldiği" saatten önce yapılmış kayıtta da var → güven ikilemi.
- Mekanik: 03:17'ye yaklaştıkça tipi ve ses bozulması artar (zaman baskısı).
- Varlıklar: `build_crevasse.py` (yarık, kara kutu enkazı), `INT_blackbox_1..4`, `INT_transmitter`.

## Bölüm 3 · "HELIKON Kapısı"
- A1 çekirdeğinin açtığı kapı → insanlıktan eski yeraltı şehri.
- Bulmaca: duvar glifleri tarayıcıyla okunur; her glif bir yıldız haritası parçası.
- Yeni NPC: mühendis Kaan, yarı donmuş; seçmeli diyalog paneli.
- Varlıklar: `build_helikon_city.py` (salon, donmuş makineler), `PATH_kaan_*`.

## Bölüm 4 · "Üç Cevap" (final, çoklu son)
1. **Sus** — antenler yok edilir; ekip kaybolur, Dünya güvende.
2. **Cevap ver** — ekip döner, 03:17 döngüsü başa sarar (New Game+).
3. **Kapıdan geç** — oyuncu kaybolur; son sahnede istasyona yeni bir mühendis gelir.
- Kayıt sisteminde `ending` alanı; ana menüde açılan sonlar galerisi.

## Teknik yol
Her bölüm aynı boru hattını kullanır: Blender betiği → GLB (`INT_/COL_/FLOOR_/PATH_` extras) → `a3d.js` `interactInner` yeni durumları → `serialize/restore` alanları → `play_test.cjs` kontrolleri.
