# Hikâyenin devamı — Bölüm 2–7 senaryo planı

Mevcut dikey dilim (istasyon, jeneratör, 3.17 MHz, buz mağarası, A1 çekirdeği) **Bölüm 1**'dir.

## Bölüm 2 · "Gelecekten Yayın" — UYGULANDI (kara kutu görevi, `js/a3d.js`, test: `tools/chapter2_test.cjs` 11/11)
- Kanca: 3.17 MHz yayını 72 saat sonrasından geliyor; konuşan oyuncunun kendi sesi.
- Mekân: verici direği + kara kutunun düştüğü buzul yarığı (orijinal oyundaki 6 görevin verici/kara kutu bölgesi).
- Bulmaca: kara kutu kaydını 4 parçadan birleştirme (tarayıcı Q ile parça bulunur, telsizde sıraya dizilir).
- Dönüm: Dr. Selin'in sesi, onun "geldiği" saatten önce yapılmış kayıtta da var → güven ikilemi.
- Mekanik: 03:17'ye yaklaştıkça tipi ve ses bozulması artar (zaman baskısı).
- Varlıklar: `build_crevasse.py` (yarık, kara kutu enkazı), `INT_blackbox_1..4`, `INT_transmitter`.

## Bölüm 3 · "HELIKON Kapısı" — UYGULANDI (WIP: `build_helikon_hall.py`, `js/a3d.js`, test: `tools/chapter3_test.cjs`)
- İşaret duvarı Bölüm 2'den sonra açılır; oyuncu buzun ~30 m altındaki tonozlu salona iner (ayrı katman, `state.inHall`).
- Salon −41°C: tek sıcak nokta ısı kuyusu. Yanlış hamle soğuk dalgasıyla vücut ısısı düşürür.
- Kaan Erdem buzda donmuş; çözmek için yüzeydeki jeneratörün yedek ISI HÜCRESİ getirilir (geri dönüş yolculuğu).
- Bulmaca: 5 stel, her birinde takımyıldız + saat işareti (Q okur, E yakar). Sıra o gecenin saatleri:
  02:58 → 03:06 → 03:12 → 03:17. 03:41 "henüz yaşanmadı" — yakılırsa harita söner.
- Kaan'ın güven sorusu (`kaanTrust` ±1) Bölüm 4–7 diyaloglarını etkiler.

---

# Gerçekçilik ilkesi (Bölüm 4–7)

Hikâyenin bilim-kurgu çekirdeği (buz altındaki medeniyet, zamanda geri gelen yayın) dışındaki her şey
**gerçek dünyanın kurallarıyla** işler. Oyuncu asker değil, sivil bir istasyon mühendisidir.

**Dayanak alınan gerçek çerçeve** (oyun içi belgelerde ve günlükte geçer; yayından önce metinler kaynağından bir kez daha doğrulanmalı):
- **Antarktika Antlaşması (1959):** Kıta yalnızca barışçıl amaçlarla kullanılır; askerî üs, manevra ve silah denemesi yasak. Antlaşma tarafları birbirinin istasyonunu denetleyebilir.
- **Madrid Protokolü (Çevre Koruma Protokolü, 1991):** Bilimsel araştırma dışındaki maden/kaynak faaliyetini yasaklar.
- **Buz altı gölleri:** Gerçekte Vostok Gölü gibi ~4 km buzun altında sıvı göller vardır; HELIKON şehri böyle bir göl havzasına kuruludur.
- **Lojistik:** Kışın (Mart–Ekim) kıtaya uçuşlar neredeyse durur; ikmal kayaklı nakliye uçakları ve buzkıran gemilerle yazın yapılır. 2091'de bile kriz bu takvimle kilitlenir: kim kışı burada geçirirse o belirler.
- **İklim:** −40/−60°C, katabatik rüzgârlar, aylarca süren karanlık. Donma, yakıt ve ısı her bölümde hayatta kalma mekaniğinin temeli kalır.

**Taraflar:** Gerçek ülke adı verilmez (siyasi tepki, mağaza incelemesi ve yaş derecelendirmesi riski).
Gerçek kurumlar kullanılır, devletler genel adlarla anılır:
- **Antarktika Antlaşması Danışma Toplantısı (ATCM)** ve **BM Güvenlik Konseyi** — diplomatik sahne.
- **Antarktika Acil Durum Koalisyonu (AAK):** Antlaşmanın askerî yasağını "olağanüstü hal" gerekçesiyle askıya alan antlaşma tarafı devletlerin geçici gücü. Bayraksız, gri üniformalı; komuta merkezi kıyıdaki eski bir lojistik üssünde.
- **Kıta Bilim Konsorsiyumu:** İstasyon ekiplerinin sivil birliği; koalisyona karşı bilim insanlarının sesi.
- **Helikonlar:** Buz altındaki medeniyet. Silahları yok; enerjileri jeotermal ve kristal rezonans. Savunmaları buzu hareket ettirmek, elektroniği susturmak ve tüneller kapatmak.

**Şiddet sınırı:** Ekranda kan, infaz yok; çatışma uzaktan, sesle, telsizden, haberlerden duyulur. Oyuncu kimseye ateş etmez.
Hedef yaş derecelendirmesi 12+.

---

## Bölüm 4 · "Üç Cevap" — UYGULANDI (`build_helikon_city.py`, `js/a3d.js`, test: `tools/chapter4_test.cjs`)
- Üç halkalı kapı (Bölüm 3 sonrası) buzun ~38 m altındaki göl havzasına açılır (katman `city`, `state.inCity`).
  Gerçek dayanak: buz altı gölleri (Vostok) basınç ve jeotermal ısıyla sıvı kalır; su −3°C, hava −4°C; dipte jeotermal ışıma.
- **Kristal dili:** 6 sembol — ◆ BİZ, ◇ SİZ, △ ZAMAN, ≈ SU, □ KAPI, ○ SESSİZLİK. Üç sembol taşı (Q ya da E) ikişer sembol öğretir; sözlük günlüğe yazılır.
- **Köprü taşı:** kıyıdaki iki taşın dört sembolü bilinince kristal köprü sudan yükselir, kuzey duvarındaki şehrin pencereleri yanar
  (köprü zemini/çarpışması `a3d_cond` ile koşullu).
- **Kristal kule:** üç cümleyi sembollerle söyler; bilinmeyen sembol çevrilmez (adadaki üçüncü taş gerekir).
- **Seçim (`ending4`):** *Sus* / *Cevap ver* / *Kapıdan geç* → bölüm sonu kartı. Her durumda 03:17 kaydı bir uyduya çoktan ulaşmıştır;
  seçim krizin nasıl başladığını belirler (Bölüm 5).

## Bölüm 5 · "İlk Temas" — Mart, son uçak
- Sonbahar: son ikmal uçağı kalkmak üzere. Konsorsiyum istasyonları boşaltıyor; oyuncu kalmayı seçer (kalırsan 6 ay kimse gelemez).
- Haberler (telsiz ve uplink'ten): ATCM olağanüstü toplantıda; bazı taraflar "Madrid Protokolü bilinmeyen bir enerji kaynağını kapsamaz" diyor.
- Oynanış: Helikon şehrinde rehberlik — Kaan ve Selin farklı taraflara çekilir (Selin konsorsiyumdan, Kaan Helikonlardan yana). `kaanTrust` diyalogları değiştirir.
- Görev: Helikonların enerji ağı ile istasyon jeneratörünü bağlamak (kışı geçirmek için). Yanlış bağlantı = karartma.

## Bölüm 6 · "Kış Ablukası" — Haziran, kutup gecesi
- BM Güvenlik Konseyi kilitlenir; AAK antlaşmanın askerî yasağını askıya alır. Kış ortasında hava indirmesi: paraşütle ikmal, kayaklı nakliye uçakları, buz üstü insansız araçlar.
- Gerçekçi tehdit: Koalisyonun amacı şehri yok etmek değil, enerji kaynağını ele geçirmek. Sondaj ekipleri göl havzasına iniyor; Helikonlar tünelleri dondurarak yanıt veriyor. Bir sondaj hattı gölü kirletirse şehir ölür.
- Oynanış (silahsız):
  - **Gizlilik:** Termal kameralı devriye dronlarından kaçmak (tipide görünmezlik, ısı izi sistemi — vücut ısısı mekaniğine bağlı: sıcakken daha görünürsün).
  - **Sabotaj:** Sondaj hattının çamur pompasını durdurmak, uydu bağlantısını karıştırmak.
  - **Kurtarma:** Mahsur kalan bir koalisyon askerini donmaktan kurtarmak ya da bırakmak (sonuca etki eder).
- Varlıklar: `build_drill_camp.py` (koalisyon sondaj kampı, konteyner modüller), dron modeli.

## Bölüm 7 · "03:17" — Ağustos, ilk güneş
- Helikonlar son çare olarak kıyı buz sahanlığını yarmaya hazırlanır (küresel deniz seviyesi tehdidi). Koalisyon kıtadaki varlığını tahliye etmekle tehdit edilir.
- Yayının sırrı çözülür: 03:17 kaydını yapan, bu son gecedeki oyuncunun kendisidir; kristal rezonans sinyali 72 saat geriye taşır.
- **Sonlar** (`ending`, kayıtta; ana menüde sonlar galerisi):
  1. **Antlaşma** — Kristal sözlük tamam + Kaan ve Selin hayatta: oyuncu uplink'ten ATCM'ye canlı bağlanır; Helikon havzası Madrid Protokolü kapsamında "korunan alan" ilan edilir. Gerçek dünyanın aracıyla barış.
  2. **Mühür** — Şehir kendini 4 km buzun altına gömer; koalisyon çekilir, dünya olanları "sondaj kazası" diye bilir. Oyuncunun günlüğü tek tanık.
  3. **Döngü** — Sahanlık yarılır; oyuncu yayını gönderir ve 03:17'ye, ilk geceye geri döner (New Game+: önceki bilgiler günlükte "déjà vu" notları olarak kalır).

## Bölüm sonrası
- Bölüm 4 ana sürümle; 5–7 ücretsiz güncellemeler olarak (her biri bir "yeni bölüm" mağaza öne çıkarması).
- Her bölüm: 1 yeni Blender mekânı + 1 yeni mekanik + test betiği + kayıt alanları.

## Teknik yol
Her bölüm aynı boru hattını kullanır: Blender betiği → GLB (`INT_/COL_/FLOOR_/PATH_` extras) → `a3d.js` `interactInner` yeni durumları → `serialize/restore` alanları → `play_test.cjs` kontrolleri.
