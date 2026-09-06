# Zombi Hayatta Kalma Roblox Oyunu — Tam Kapsamlı Yapım Prompt'u

> **Bu dosya nedir?** Bir yapay zekâ kodlama ajanına (Claude Code, Cursor, Copilot Agent vb.) veya
> bir geliştiriciye verildiğinde, *The Walking Dead* atmosferinde bir Roblox hayatta kalma oyununu
> sıfırdan kurmasını sağlayacak eksiksiz şartname.
>
> **Kullanım:** Tek seferde vermek yerine **Faz 0 → Faz 9** sırasıyla ilerleyin (Bölüm 20).
> Her fazın başında bu dosyanın "Ortak Bağlam" bölümünü (Bölüm 1–4) tekrar yapıştırın.

---

## 0. Hızlı Versiyon (tek paragraf prompt)

> Roblox Studio için Luau ile, *The Walking Dead* atmosferinde, sunucu otoriteli (server-authoritative)
> bir zombi hayatta kalma oyunu yap. Harita prosedürel üretilsin: sisli ormanlar, ölü ağaçlar,
> terk edilmiş köyler, çatısı çökmüş/duvarları delik yıkık evler, bozuk asfalt yollar, terk edilmiş
> araçlar. Zombiler farklı tiplerde olsun (yavaş yürüyen, koşan, tank, çığlıkçı), görme/duyma
> duyuları ve sürü (horde) davranışı olsun; öldürülünce yere loot düşürsünler (silah, mermi, bıçak,
> tıbbi malzeme, yiyecek). Silah çeşitleri: balta, bıçak, palet, levye, beyzbol sopası, tabanca,
> revolver, pompalı tüfek, SMG, otomatik tüfek, keskin nişancı tüfeği — her biri kendi hasar,
> geri tepme, dağılım, şarjör ve yeniden doldurma değerleriyle. Yürüme, koşma, çömelme, nişan alma,
> yeniden doldurma ve yakın dövüş animasyonları olsun; ayrıca prosedürel silah sallanması ve kamera
> sarsıntısı. Katmanlı ve mesafeye duyarlı gerçekçi silah sesleri (mekanik + patlama + yankı kuyruğu)
> kullan. Gerçekçi bir ana menü ve tam bir ayarlar menüsü (grafik, ses, hassasiyet, FOV, tuş
> atamaları, erişilebilirlik) yap; ayarlar DataStore ile kalıcı olsun. Tüm asset ID'lerini tek bir
> `Assets.luau` dosyasında topla ve eksik olanlar için güvenli yedek davranış (fallback) yaz.
> Kod Rojo uyumlu klasör yapısında, `--!strict` Luau ile, modüler ve yorumlanmış olsun.

Aşağısı bu paragrafın **uygulanabilir tam şartnamesidir.**

---

## 1. Rol ve Hedef (Ortak Bağlam — her fazda yapıştır)

**Rolün:** Roblox'ta yayınlanmış hayatta kalma/nişancı oyunları üretmiş kıdemli bir Roblox oyun
geliştiricisisin. Luau, Roblox motor API'si, ağ replikasyonu, prosedürel dünya üretimi, oyun hissi
(game feel) ve UI/UX tasarımı konularında uzmansın.

**Hedef:** *The Walking Dead* dizisinin **atmosferinden ilham alan** (marka, karakter, logo veya
telifli içerik **kopyalamadan**) çok oyunculu bir zombi hayatta kalma oyunu.

**Oyunun adı (jenerik, telif güvenli öneriler):** `DEAD SIGNAL`, `THE LAST OUTPOST`,
`AFTER THE FALL`, `QUIET COUNTY`. Varsayılan: **DEAD SIGNAL**.

**Tasarım sütunları:**
1. **Gerilim > aksiyon.** Mermi az, ses tehlikelidir, gece ölümcüldür.
2. **Ses = risk.** Ateş etmek sürüyü çeker; bıçak sessizdir ama yakındır.
3. **Yağma döngüsü.** Keşfet → yağmala → hayatta kal → daha derine git.
4. **Ağırlık hissi.** Silahlar ağır, nişan alma yavaş, dövüş yorucudur.

---

## 2. Teknik Yığın ve Katı Kurallar

| Konu | Karar |
|---|---|
| Dil | Luau, tüm modüllerde `--!strict` |
| Yapı aracı | Rojo 7 (`default.project.json`) + Rokit/Aftman |
| Karakter | R15, `Humanoid.RigType = R15`, custom `Animate` yerine kendi LocomotionController'ın |
| Ağ modeli | **Sunucu otoriteli.** Hasar, loot, envanter, zombi durumu yalnızca sunucuda hesaplanır |
| Kod stili | StyleLuau/Stylua uyumlu, 4 boşluk girinti, PascalCase modül, camelCase değişken |
| Analiz | `selene` + `luau-analyze` temiz geçmeli |
| Kalite | Her modül tek sorumluluk; 400 satırı aşan dosyayı böl |

**Yasaklar:**
- `while true do ... end` içinde `wait()` kullanma → `task.wait()` veya `RunService` sinyalleri.
- `FilteringEnabled` bypass'ı, istemciye hasar hesabı yaptırma yok.
- Telifli marka/karakter/logo/asset kopyalama yok.
- Sabit kodlanmış (hard-coded) asset ID'si dosyaların içine dağıtılmaz — hepsi `Assets.luau`'da.
- `game.Workspace.Terrain:Clear()` gibi geri dönüşü olmayan işlemler için onay/bayrak (flag) şart.

---

## 3. Proje Klasör Yapısı (birebir bu şekilde üret)

```
roblox-walking-dead/
├── default.project.json          # Rojo eşlemesi
├── rokit.toml                    # Araç sürümleri (rojo, selene, stylua)
├── selene.toml / stylua.toml
├── README.md                     # Kurulum + çalıştırma + mimari
├── ASSETS.md                     # Asset ID doldurma rehberi (Bölüm 17)
└── src/
    ├── shared/                   # → ReplicatedStorage/Shared
    │   ├── Config.luau           # Tüm dengeleme (balance) sabitleri
    │   ├── Assets.luau           # TÜM ses/animasyon/görsel ID'leri (tek kaynak)
    │   ├── Weapons.luau          # Silah tanım tablosu
    │   ├── ZombieTypes.luau      # Zombi tanımları
    │   ├── LootTables.luau       # Loot tabloları + nadirlik
    │   ├── Items.luau            # Eşya tanımları (tıbbi, yiyecek, mermi, malzeme)
    │   ├── Net.luau              # RemoteEvent/Function kayıt + tip güvenli sarmalayıcı
    │   └── Util/
    │       ├── Spring.luau       # Yaylı yumuşatma (kamera/silah sway)
    │       ├── Noise.luau        # Fraktal Perlin (harita yüksekliği, biyom)
    │       ├── Signal.luau       # Hafif event sınıfı
    │       ├── Pool.luau         # Nesne havuzu (mermi izi, kan, kovan)
    │       └── Table.luau        # deepCopy, weightedPick, shuffle
    ├── server/                   # → ServerScriptService/Server
    │   ├── init.server.luau      # Önyükleme sırası
    │   ├── World/
    │   │   ├── MapGenerator.luau # Ana orkestratör (seed'li)
    │   │   ├── TerrainGen.luau   # WriteVoxels ile arazi
    │   │   ├── ForestGen.luau    # Ağaç/çalı/kaya dağılımı
    │   │   ├── VillageGen.luau   # Köy yerleşimi, sokaklar, çitler
    │   │   ├── RuinedHouse.luau  # Prosedürel yıkık ev üreteci
    │   │   ├── RoadGen.luau      # Yollar, köprüler, terk edilmiş araçlar
    │   │   ├── PropGen.luau      # Varil, barikat, çadır, ceset, kamp ateşi
    │   │   └── Atmosphere.luau   # Gündüz/gece, sis, hava durumu
    │   ├── Zombies/
    │   │   ├── ZombieFactory.luau  # Rig üretimi + görsel varyasyon
    │   │   ├── ZombieAI.luau       # Durum makinesi (state machine)
    │   │   ├── Senses.luau         # Görüş konisi, işitme, koku
    │   │   └── HordeDirector.luau  # Sürü yönetimi, spawn bütçesi, baskı eğrisi
    │   ├── Systems/
    │   │   ├── CombatService.luau    # Raycast doğrulama, hasar, uzuv çarpanı
    │   │   ├── NoiseService.luau     # Gürültü olayları → zombi çekimi
    │   │   ├── LootService.luau      # Drop, dünya loot'u, konteyner yağması
    │   │   ├── InventoryService.luau # Slot/ağırlık, ekipman, mermi
    │   │   ├── SurvivalService.luau  # Açlık, susuzluk, kanama, enfeksiyon
    │   │   ├── PlayerService.luau    # Spawn, ölüm, yeniden doğma, istatistik
    │   │   └── DataService.luau      # DataStore: ayarlar + ilerleme (ProfileStore deseni)
    │   └── Security/
    │       └── AntiExploit.luau      # Hız/menzil/atış hızı doğrulaması, rate limit
    └── client/                   # → StarterPlayer/StarterPlayerScripts/Client
        ├── init.client.luau
        ├── Controllers/
        │   ├── InputController.luau       # Klavye/gamepad/dokunmatik, tuş atama
        │   ├── LocomotionController.luau  # Yürü/koş/çömel/sprint + stamina
        │   ├── AnimationController.luau   # Animasyon durum makinesi + katmanlar
        │   ├── CameraController.luau      # Omuz üstü/ADS, sway, sarsıntı, FOV
        │   ├── WeaponController.luau      # Viewmodel, ateş girdisi, reload akışı
        │   ├── SoundController.luau       # Katmanlı ses, mesafe, reverb, occlusion
        │   ├── InteractionController.luau # ProximityPrompt, yağma, kapı
        │   └── EffectsController.luau     # Kan, namlu alevi, kovan, mermi izi, hitmarker
        ├── UI/
        │   ├── Theme.luau        # Renk paleti, font, animasyon süreleri
        │   ├── MainMenu.luau
        │   ├── SettingsMenu.luau
        │   ├── HUD.luau
        │   ├── InventoryUI.luau
        │   ├── LootUI.luau
        │   ├── DeathScreen.luau
        │   └── Notifications.luau
        └── State/
            └── SettingsStore.luau  # Yerel ayar durumu + sunucu senkronu
```

---

## 4. Önyükleme (Bootstrap) Sırası

**Sunucu:** `Config` yükle → `Net` remote'larını oluştur → `MapGenerator` (seed) çalıştır →
`Atmosphere` başlat → `HordeDirector` başlat → servisleri kaydet → oyuncu bağlantılarını dinle.

**İstemci:** Yükleme ekranı göster (ReplicatedFirst) → ayarları çek → UI kur → controller'ları başlat →
harita replikasyonunu bekle → ana menüyü aç → oyuncu "OYNA" deyince kontrolü ver.

Oyuncu ana menüdeyken karakter **spawn olmaz** (`Players.CharacterAutoLoads = false`).

---

## 5. Dünya Üretimi (Prosedürel)

### 5.1 Arazi
- Harita boyutu: **2048 × 2048 stud**, seed tabanlı (`Config.World.Seed`, 0 = rastgele).
- `Terrain:WriteVoxels` ile 4 stud çözünürlükte, 256 studluk parçalar hâlinde yaz (kare kare,
  aralara `task.wait()` koy ki sunucu donmasın).
- Yükseklik: 3 oktavlı fraktal Perlin (`Util/Noise`), tepeler 0–60 stud.
- Materyaller yüksekliğe/eğime göre: `Grass`, `LeafyGrass`, `Mud`, `Ground`, `Rock`, `Sand` (dere yatağı).
- Biyomlar: **Yoğun Orman (%45)**, **Açıklık/Tarla (%25)**, **Köy (%15)**, **Bataklık (%10)**, **Yol koridoru (%5)**.

### 5.2 Orman
- Ağaç yoğunluğu biyoma göre 0.004–0.02 ağaç/stud².
- Ağaç tipleri: **Yaşlı meşe** (kalın gövde, geniş yaprak kümesi), **çam** (konik katmanlar),
  **ölü/kavrulmuş ağaç** (yapraksız, çatallı dallar), **devrilmiş kütük**, **kuru fidan**.
- Her ağaç: gövde (Cylinder, `Wood`, kahve tonlarında rastgele renk), 2–5 dal, 3–7 yaprak kümesi
  (Ball/Wedge, `LeafyGrass`, sonbahar/ölü yeşil-kahve paleti), rastgele ölçek (0.7–1.6) ve Y rotasyonu.
- Alt bitki örtüsü: eğrelti otu, çalı, uzun ot kümeleri, kaya, mantar, yosunlu kütük.
- **Performans:** ağaçları `Model` içinde grupla, `Model.LevelOfDetail = StreamingMesh`,
  `PrimaryPart` ata, tüm parçalar `Anchored = true`, yaprak kümeleri `CanCollide = false`,
  `CanQuery = false`, `CanTouch = false`.

### 5.3 Yıkık Evler (`RuinedHouse.luau`)
Parametrik üreteç: `build(cframe, opts)` → `opts = {width, depth, floors, ruinLevel (0–1), burnt, boarded}`.

Her ev şunları içermeli:
- **Temel:** çatlak beton döşeme, yer yer eksik parçalar.
- **Duvarlar:** segmentlere bölünmüş; `ruinLevel`'e göre segmentler silinir veya delinir
  (moloz yığını bırakarak). Materyal: `Brick`, `Concrete`, `WoodPlanks`, soluk/kirli renkler.
- **Çatı:** kısmen çökmüş — kirişler açıkta (ince `Wood` parçalar), kiremitler dağınık.
- **Pencereler:** kırık cam (`Glass`, düşük transparanlık, çatlak decal), üzeri çapraz tahtalı
  (`boarded = true` ise), pervazlar çürük.
- **Kapı:** menteşesinden sarkmış (rastgele açı) veya barikatlı.
- **İç mekân:** devrilmiş masa/sandalye, yatak, dolap, yırtık halı, kan lekeleri (SurfaceGui/Decal),
  duvar yazıları ("BURADA DEĞİL", "SESSİZ OL", tarih çeteleleri).
- **Yağma noktaları:** her evde 1–4 konteyner (dolap, buzdolabı, valiz, tıbbi kutu) → `LootService`.
- **Zombi barındırma:** %35 ihtimalle 1–3 uyuyan zombi (oyuncu yaklaşınca uyanır).
- **Detaylar:** moloz yığını, kırık tuğla, devrilmiş dolap, sarmaşık, is/kurum (yanmış evlerde
  `Color3` koyulaştırma + `Neon` yerine `Slate`/`Basalt` materyal).

### 5.4 Köyler
- Haritada **3–5 köy**, her biri 6–14 yapı.
- Yerleşim: ana sokak + yan sokaklar, evler yola bakacak şekilde hizalı, aralarda bahçe/çit.
- Ortak yapılar: kilise/okul (büyük tek mekân), benzin istasyonu, market, ahır, su kulesi,
  karakol (yüksek değerli loot + yoğun zombi).
- Sokak dekoru: devrilmiş çöp konteynerleri, terk edilmiş arabalar (kapıları açık, camları kırık),
  otobüs barikatı, dikenli tel, kum torbası mevzileri, "KARANTİNA" tabelaları, direkler, telefon kulübesi.
- **Tehlike/ödül dengesi:** köy merkezi = en iyi loot + en yoğun zombi.

### 5.5 Yollar ve Geçişler
- Köyleri birbirine bağlayan bozuk asfalt yol (Terrain `Asphalt` + çatlak decal'li düz parçalar).
- Terk edilmiş araç kuyrukları, devrilmiş kamyon, çökmüş köprü, dere geçişi.

### 5.6 Atmosfer (`Atmosphere.luau`)
- `Lighting.Technology = Future`, `GlobalShadows = true`, `EnvironmentDiffuseScale ≈ 0.35`.
- **Gün döngüsü:** 24 dakika = 1 oyun günü. Gece daha uzun hissettirilir (gece %55).
- Efektler: `Atmosphere` (Density 0.42, Haze 2.2, Glare 0.15), `Clouds` (Cover 0.75, Density 0.6),
  `ColorCorrection` (Saturation −0.25, soğuk ton), `Bloom`, `SunRays`, `DepthOfField`.
- **Hava durumu döngüsü:** Açık → Sisli → Yağmurlu → Fırtına. Yağmur ve sis görüşü düşürür,
  zombilerin oyuncuyu duymasını **zorlaştırır** (kamuflaj mekaniği).
- Gece: el feneri gerekli; el feneri zombileri **çeker** (risk/ödül).

---

## 6. Karakter, Hareket ve Animasyon

### 6.1 Hareket durumları
| Durum | Hız | Notlar |
|---|---|---|
| Idle | 0 | Nefes alma salınımı |
| Sinsi (Ctrl) | 6 | Gürültü yarıçapı ×0.35 |
| Yürüme | 12 | Varsayılan |
| Koşma/Sprint (Shift) | 20 | Stamina tüketir, nişan alınamaz, gürültü ×1.8 |
| Çömelme | 8 | Profil düşer, gizlilik +, doğruluk + |
| Nişan alma (ADS) | 8 | FOV daralır, dağılım −%60 |

- **Stamina:** 100 birim, sprint −18/sn, yenilenme +12/sn (2 sn gecikmeli). Bitince hız düşer ve
  nefes nefese ses çalar.
- **Ağırlık:** taşınan envanter ağırlığı hızın %15'ine kadar etki eder.

### 6.2 Animasyon sistemi (`AnimationController.luau`)
- Roblox varsayılan `Animate` script'ini **devre dışı bırak**, kendi durum makineni kur.
- Katmanlar: **Base** (locomotion), **Overlay** (üst beden silah pozu), **Action** (reload, dövüş,
  eşya kullanma). `AnimationTrack.Priority` sırasıyla `Core / Movement / Action / Action4`.
- Gerekli animasyon slotları (`Assets.Animations` içinde ID'lenir):
  `idle`, `idleArmed`, `walk`, `walkArmed`, `run`, `sprint`, `crouchIdle`, `crouchWalk`,
  `aimPistol`, `aimRifle`, `reloadPistol`, `reloadRifle`, `reloadShotgun`,
  `meleeSwing1`, `meleeSwing2`, `meleeHeavy`, `hitReact`, `death1`, `death2`, `jump`, `fall`, `land`.
- **ID yoksa çökme yok:** eksik animasyon ID'si için uyarı logla ve prosedürel yedeğe düş.
- **Prosedürel katman (asset gerektirmez):** Motor6D `C0` offset'leriyle silah tutuş pozu,
  yürürken gövde bobbing'i, sprintte silahın aşağı inmesi, ADS'te omuz hizalaması, nefes salınımı.
  `Spring` modülüyle yumuşat — bu, animasyon ID'leri boşken bile oyunun düzgün görünmesini sağlar.
- Zombiler için ayrı set: `zombieIdle`, `zombieShamble` (topallayarak yürüme), `zombieRun`,
  `zombieAttack1/2`, `zombieScream`, `zombieCrawl`, `zombieDeath`.

---

## 7. Silah Sistemi

### 7.1 Ortak mekanikler
- **Hitscan raycast** (mermi düşüşü yalnız keskin nişancıda), `RaycastParams` ile takım/karakter filtresi.
- İstemci nişan alır ve görsel efekti oynatır; **sunucu doğrular** (menzil, atış hızı, görüş hattı,
  mermi sayısı) ve hasarı uygular.
- **Dağılım (spread):** taban + hareket cezası + ardışık atış birikimi; ADS ve çömelme azaltır.
- **Geri tepme (recoil):** dikey desen + yatay rastgelelik; `Spring` ile kamera geri döner.
- **Uzuv çarpanları:** Kafa ×3.0, Gövde ×1.0, Kol/Bacak ×0.65.
- **Yeniden doldurma:** taktiksel (namluda mermi kalır) vs boş şarjör (daha uzun) ayrımı.
- **Yakın dövüş:** koni içi `GetPartBoundsInBox` taraması, sallama başına 1 vuruş, stamina tüketir,
  ağır saldırı (sağ tık) ×2 hasar + ×2 süre.
- **Durabilite (opsiyonel):** dövüş silahlarında kullanım başına aşınma, kırılınca yok olur.

### 7.2 Silah tablosu (dengeleme başlangıç değerleri)

| Silah | Sınıf | Hasar | Atış/dk | Şarjör | Reload | Menzil | Gürültü (stud) | Notlar |
|---|---|---|---|---|---|---|---|---|
| Mutfak Bıçağı | Dövüş | 25 | 130 | – | – | 4 | 8 | Çok sessiz, hızlı |
| Av Bıçağı | Dövüş | 34 | 115 | – | – | 4.5 | 8 | Kafaya ×3 = tek vuruş |
| Balta | Dövüş | 58 | 60 | – | – | 5.5 | 14 | Ağır, stamina yer |
| Palet (Machete) | Dövüş | 45 | 85 | – | – | 5.5 | 10 | Dengeli |
| Levye | Dövüş | 40 | 75 | – | – | 5 | 12 | Kapı açar (araç) |
| Beyzbol Sopası | Dövüş | 38 | 80 | – | – | 6 | 12 | Sersemletme şansı %20 |
| Tabanca (9mm) | Tabanca | 28 | 380 | 15 | 2.1 sn | 180 | 90 | Yaygın mermi |
| Revolver (.357) | Tabanca | 55 | 150 | 6 | 3.4 sn | 220 | 130 | Yüksek hasar, yavaş |
| Pompalı Tüfek | Pompalı | 12×8 saçma | 70 | 6 | 0.7 sn/mermi | 60 | 150 | Yakın mesafe kral |
| SMG | SMG | 22 | 750 | 30 | 2.4 sn | 140 | 110 | Yüksek dağılım |
| Otomatik Tüfek | Tüfek | 34 | 600 | 30 | 2.8 sn | 320 | 140 | Ana silah |
| Av Tüfeği (bolt) | Tüfek | 75 | 45 | 5 | 3.6 sn | 400 | 150 | Sürgülü |
| Keskin Nişancı | Sniper | 120 | 35 | 5 | 4.0 sn | 900 | 170 | Dürbün ×6, mermi düşüşü |
| Yaralayıcı Yay | Yay | 70 | 40 | 1 | 1.8 sn | 250 | 15 | **Sessiz**, ok geri alınır |

**Mermi türleri:** `9mm`, `.357`, `12ga`, `5.56`, `7.62`, `.308`, `Ok`. Her biri ayrı envanter kalemi.

### 7.3 Viewmodel ve his (game feel)
- Birinci şahıs viewmodel: kamera'ya bağlı ayrı model, `RenderStepped` ile takip, `Spring` sway.
- Namlu alevi (`PointLight` + `ParticleEmitter`, 0.05 sn), kovan atma (havuzdan, 3 sn sonra iade),
  mermi izi (ince `Beam`/`Part`, 0.05 sn), isabet efektleri **yüzeye göre**: beton tozu, ahşap kıymık,
  metal kıvılcım, toprak, kan sıçraması.
- **Hitmarker:** normal isabet beyaz, kafa vuruşu kırmızı + farklı ses.
- Kamera sarsıntısı: her silahın kendi `shake` profili (yoğunluk, süre, sönümleme).

---

## 8. Ses Sistemi (Gerçekçilik Anahtarı)

`SoundController.luau` **katmanlı ses** çalmalı — tek dosya değil:

1. **Mekanik katman** (tetik/sürgü/mekanizma) — her zaman yakın ve kuru (dry).
2. **Patlama katmanı** (asıl gürültü) — pitch ±%4 rastgele, her atışta farklı.
3. **Kuyruk/yankı katmanı** — mesafeye ve ortama göre; ormanda uzun, ev içinde kısa ve tok.
4. **Mesafe katmanı** — 120+ stud uzaktaki atışlar için ayrı "uzak atış" sesi (crack-thump).

**Uygulama kuralları:**
- `SoundGroup`: `Master → {SFX, Music, UI, Ambience, Voice}` — ayarlar menüsüne birebir bağlanır.
- `RollOffMode = InverseTapered`, `RollOffMinDistance = 12`, `RollOffMaxDistance = silahın gürültü yarıçapı`.
- **Occlusion:** dinleyici ile kaynak arasında raycast → duvar varsa `EqualizerSoundEffect` ile
  yüksek frekansları kes ve ses seviyesini %45 düşür.
- **Reverb:** `SoundService.AmbientReverb` ortama göre değişsin (`Forest`, `Room`, `Hallway`,
  `CaveTunnel` ev içi/dış ayrımıyla).
- **Kulak çınlaması:** susturucusuz atışta yakında patlama → kısa `LowPassFilter` + tiz çınlama katmanı.
- Diğer sesler: adım (yüzeye göre: çim, çakıl, ahşap, beton, su, yaprak), nefes/stamina,
  yeniden doldurma parçaları, envanter, kapı gıcırtısı, zombi hırıltısı/çığlığı/ısırığı,
  ortam sesleri (rüzgâr, karga, uzak uğultu, gıcırdayan ağaç), gerilim müziği (sürü yaklaşınca yükselir).

**Asset ID'leri:** Bölüm 17'deki kurallara göre `Assets.luau`'da tanımlanır; ID `0` ise sistem
sessizce atlar ve **bir kez** uyarı loglar.

---

## 9. Zombi Sistemi

### 9.1 Tipler
| Tip | Can | Hız | Hasar | Oran | Özellik |
|---|---|---|---|---|---|
| Yürüyen (Walker) | 100 | 5 | 12 | %65 | Temel, sürü hâlinde |
| Koşan (Runner) | 80 | 17 | 15 | %18 | Sese çok duyarlı |
| Sürünen (Crawler) | 55 | 4 | 10 | %8 | Alçak, geç fark edilir |
| Tank (Brute) | 420 | 9 | 35 | %6 | Barikat kırar, sersemlemez |
| Çığlıkçı (Screamer) | 70 | 12 | 8 | %3 | Çığlıkla 250 stud sürü çağırır |

### 9.2 AI durum makinesi
`Idle → Wander → Alerted (araştır) → Chase → Attack → Stunned → Dead`
- Geçişler duyu girdileriyle olur; her zombi 0.15–0.4 sn arası **kademeli** güncellenir
  (aynı karede hepsi güncellenmez — performans için zaman dilimlemesi/time-slicing).
- **Pathfinding:** `PathfindingService` yalnızca 40+ stud uzaktayken; yakında doğrudan yönelme
  (`MoveTo`) — CPU tasarrufu. Yol hesabı başarısızsa engelden kaçınma raycast'i.
- **Sürü davranışı:** yakındaki zombiler hedefi paylaşır (`HordeDirector` üzerinden), birbirine
  yapışmayı önlemek için hafif ayrılma (separation) kuvveti.

### 9.3 Duyular (`Senses.luau`)
- **Görüş:** 60° koni, gündüz 120 stud / gece 45 stud; el feneri açıksa +100 stud.
  Görüş hattı raycast ile doğrulanır.
- **İşitme:** `NoiseService` olayları (adım, silah sesi, kapı, cam kırılması) yarıçap içindeyse tetikler.
- **Koku:** 25 stud, duvar arkasından bile çalışır (çok yavaş tepki) — saklanmayı tamamen güvenli yapmaz.
- **Zombi kamuflajı (opsiyonel mekanik):** zombi kanı sürünce algılanma yarıçapı ×0.3, süre 90 sn.

### 9.4 Hasar ve ölüm
- Kafa vuruşu ×3 (çoğu zombiyi tek atışta öldürür — TWD hissi).
- Uzuv hasarı: bacak kopunca zombi **Crawler'a dönüşür**, kol kopunca hasarı düşer.
- Ölümde: fizik ragdoll (`BallSocketConstraint`), kan havuzu decal'i, ceset 45 sn sonra temizlenir.
- **Ölümde loot düşer** → Bölüm 10.

### 9.5 Horde Director
- Bölge başına aktif zombi bütçesi (varsayılan 60, sunucu yüküne göre otomatik düşer).
- **Baskı eğrisi:** oyuncu uzun süre güvendeyse gerilim artar → sürü gönderilir; ölümden sonra
  kısa "nefes alma" penceresi.
- **Gece dalgası:** gece zombi yoğunluğu ×1.6, koşan oranı ×2.
- Spawn kuralı: oyuncunun görüş alanı **dışında** ve 90–220 stud arasında.

---

## 10. Loot Sistemi

### 10.1 Zombi ölüm loot'u
- Ölen her zombi `LootTables.ZombieDrop` tablosundan çeker. Varsayılan düşme şansı %45.
- Ağırlıklı örnek tablo:
  `Mermi %30 · Bandaj %14 · Konserve %12 · Su %10 · Bıçak %8 · Hurda %8 · Tabanca %5 ·
   Ağrı kesici %5 · Balta %3 · Tüfek %2 · Antibiyotik %2 · (nadir) Keskin nişancı %1`
- Tip bonusu: Tank → garanti loot + yüksek nadirlik; Karakol zombisi → askeri masa (tüfek/5.56).
- Düşen loot: yere fiziksel çanta/eşya modeli + `ProximityPrompt` ("E — Al"), 3 dk sonra kaybolur,
  yerde parıltı (`Highlight`/`Beam`) nadirliğe göre renkli.

### 10.2 Dünya loot'u
- Konteynerler: dolap, buzdolabı, valiz, tıbbi kutu, araç bagajı, silah kasası, askeri sandık.
- Her konteynerin kendi tablosu ve **yağma süresi** (2–5 sn kanal — bu sırada savunmasızsın, gürültü çıkar).
- **Yeniden dolum (respawn):** konteyner 12–20 dakika sonra tekrar dolar (sunucu ömrü boyunca).
- Nadirlik renkleri: `Yaygın (gri) · Alışılmış (yeşil) · Nadir (mavi) · Askeri (mor) · Efsanevi (turuncu)`.

### 10.3 Envanter
- Ağırlık tabanlı (varsayılan 45 kg) + hızlı erişim çubuğu (1–5 tuşları).
- Ekipman slotları: **Birincil**, **İkincil**, **Dövüş**, **Sırt çantası**, **Kıyafet** (zırh/ağırlık).
- Sürükle-bırak arayüz, eşya birleştirme (stack), yere atma, kullanma.
- **Crafting (opsiyonel, Faz 9):** bandaj = paçavra ×2, molotof = şişe + benzin + paçavra,
  susturucu = boru + izolasyon, ok = dal + hurda.

---

## 11. Hayatta Kalma Mekaniği

| Sistem | Davranış |
|---|---|
| Sağlık | 100; ölünce eşyaların yere düşer (hardcore) veya %50'si kaybolur (ayarlanabilir) |
| Açlık | 0.25/dk azalır; 0 olunca 0.5 hasar/sn |
| Susuzluk | 0.4/dk azalır; 0 olunca 0.8 hasar/sn |
| Kanama | Zombi vuruşunda %25 ihtimal; 1.5 hasar/sn, bandaj durdurur |
| Enfeksiyon | Isırıkta %15; 4 dk içinde antibiyotik alınmazsa yavaş ölüm (ekran yeşilimsi filtre) |
| Kırık bacak | Yüksekten düşme; hız −%40, atel gerekir |
| Stamina | Bölüm 6.1 |

Yeniden doğma: en yakın **güvenli sığınak**ta (kilise/karakol) 12 sn geri sayım.

---

## 12. Arayüz (UI/UX) — Gerçekçi Tasarım

### 12.1 Tasarım dili (`Theme.luau`)
- Palet: arka plan `#0B0C0A`, panel `#14161380`, kenarlık `#2A2E28`, metin `#D6D3C8`,
  vurgu `#8B2E22` (kurumuş kan kırmızısı), uyarı `#C4913A`.
- Font: `Enum.Font.Oswald`/`GothamBold` başlık, `Gotham`/`SourceSans` gövde.
- Doku hissi: hafif film grain + vignette + tarama çizgisi (ImageLabel, çok düşük opaklık).
- Tüm geçişler `TweenService`, 0.18–0.35 sn, `Enum.EasingStyle.Quint`.
- Her buton: hover (parlaklık + hafif kayma), tık sesi, focus çerçevesi (gamepad/klavye gezinme).

### 12.2 Ana Menü (`MainMenu.luau`)
- Arka plan: oyun dünyasında **yavaş kayan sinematik kamera** (ViewportFrame değil, gerçek kamera
  waypoint'leri arasında `TweenService` ile döngü) + `BlurEffect` + `ColorCorrection`.
- Ortada oyun logosu (metin tabanlı, telif güvenli), altında sürüm numarası.
- Menü öğeleri: **OYNA · DEVAM ET · AYARLAR · KONTROLLER · KREDİLER · ÇIKIŞ**.
- Sağ altta: sunucu bilgisi, hayatta kalan sayısı, oyun içi saat, hava durumu ikonu.
- Ortam sesi: rüzgâr + uzak karga + düşük frekanslı gerilim uğultusu.
- "OYNA"ya basınca: karartma → karakter spawn → HUD açılır (menü kamerasından oyun kamerasına yumuşak geçiş).

### 12.3 Ayarlar Menüsü (`SettingsMenu.luau`) — sekmeli
**GRAFİK:** Kalite ön ayarı (Düşük/Orta/Yüksek/Ultra/Özel) · Görüş mesafesi · Gölgeler · Sis yoğunluğu ·
Bloom · Motion blur · Depth of field · Film grain · Kan efektleri · Ceset kalıcılığı · FPS sayacı ·
Ağaç yoğunluğu.

**SES:** Ana ses · Efektler · Müzik · Arayüz · Ortam · Ses (voice) · Dinamik aralık (gece modu) ·
Kulak çınlaması aç/kapa.

**KONTROL:** Fare hassasiyeti · ADS hassasiyeti çarpanı · Y ekseni ters · FOV (70–110) ·
Nişanda FOV · Sprint: basılı tut/aç-kapa · Çömelme: basılı tut/aç-kapa · Titreşim ·
**Tam tuş atama tablosu** (her eylem yeniden atanabilir, çakışma uyarısı verir).

**ARAYÜZ:** Crosshair tipi/renk/boyut · HUD opaklığı · Hasar göstergesi · Hitmarker · Hasar sayıları ·
Minimap aç/kapa · Altyazılar · Dil (TR/EN).

**ERİŞİLEBİLİRLİK:** Kamera sarsıntısı azalt · Renk körlüğü modu (Protanopi/Döteranopi/Tritanopi) ·
Metin boyutu · Yüksek kontrast · Otomatik koşma · Işık çakması azalt.

> Her ayar **anında** uygulanmalı (kaydet'e basmayı beklemeden), `DataService` ile DataStore'a
> yazılmalı ve oyuncu tekrar girdiğinde yüklenmelidir. "Varsayılanlara dön" butonu bulunmalı.

### 12.4 HUD
- Sol alt: sağlık, stamina, açlık, susuzluk (ince yatay çubuklar, kritikte yanıp söner).
- Sağ alt: silah adı, `şarjör / rezerv`, ateş modu, ekipman ikonu.
- Orta: dinamik crosshair (dağılıma göre açılır/kapanır), etkileşim ipucu.
- Üst orta: **gizlilik göstergesi** (Gizli / Şüpheleniliyor / Görüldü) + yakındaki zombi baskısı.
- Kenar: hasar yönü göstergesi, düşük canda kırmızı vignette + kalp atışı sesi.
- Sağ üst: oyun içi saat, gün sayacı, hava durumu.

### 12.5 Diğer ekranlar
- **Yükleme ekranı** (ReplicatedFirst): siyah zemin, ilerleme çubuğu, dönen ipucu metinleri.
- **Envanter:** ızgara + ekipman paneli + ağırlık göstergesi, sürükle-bırak.
- **Yağma penceresi:** solda konteyner, sağda envanter, "Hepsini al" butonu.
- **Ölüm ekranı:** yavaş siyah-beyaz geçiş, "HAYATTA KALDIN: X gün · Öldürme: Y · Yağma: Z",
  yeniden doğma geri sayımı.

---

## 13. Ağ ve Güvenlik

- Tüm `RemoteEvent`'ler `Net.luau` üzerinden tanımlanır; her biri için **rate limit** (örn. atış
  isteği ≤ silahın atış hızı ×1.15) ve **tip doğrulaması**.
- Sunucu doğrulaması: atış menzili, görüş hattı, oyuncu hızı (teleport tespiti), envanterde o
  silahın gerçekten olması, mermi sayısı.
- İstemci **asla** hasar, loot içeriği veya envanter değişikliği bildiremez — yalnızca **niyet** gönderir.
- İhlal → sayaç artır; eşik aşılırsa oyuncuyu kick'le ve logla (`AntiExploit.luau`).
- Zombi konumları sunucuda; istemci yalnızca yorumlar (interpolation).

---

## 14. Performans Bütçesi

- Hedef: **60 FPS / orta seviye PC**, sunucu tick ≤ 12 ms.
- `StreamingEnabled = true`, `StreamingTargetRadius = 1024`, `StreamingIntegrityMode = MinimumRadius`.
- Toplam statik part hedefi ≤ 60.000; ağaçlar `Model` gruplu ve LOD'lu.
- Zombi limiti: aynı anda aktif ≤ 60; uzaktakiler "uyku" modunda (AI güncellemesi seyrek).
- Nesne havuzu (`Pool.luau`): kovan, kan decal'i, mermi izi, hasar sayısı.
- `CollisionGroup`'lar: `Players`, `Zombies`, `Loot`, `Debris`, `Foliage` — yapraklar hiçbir şeyle çarpışmaz.
- Tüm dekor parçaları: `Anchored = true`, `CanQuery/CanTouch = false` (gerekmeyenlerde).

---

## 15. Dengeleme (Balance) — Tek Dosya

`Config.luau` içinde gruplanmış ve **yorumlanmış** olarak: dünya (seed, boyut, yoğunluklar),
oyuncu (can, hız, stamina, ağırlık), hayatta kalma oranları, zombi (bütçe, oranlar, duyular),
loot (şanslar, respawn), gün/gece süreleri, zorluk çarpanları (`Kolay/Normal/Zor/Kâbus`).
Sihirli sayı (magic number) başka hiçbir dosyada bulunmamalı.

---

## 16. Test ve Kabul Kriterleri

Teslimden önce şunların **hepsi** doğrulanmalı:

- [ ] Rojo ile senkron edilip Studio'da hatasız çalışıyor; `Output` temiz (uyarı hariç).
- [ ] `luau-analyze` ve `selene` hatasız geçiyor.
- [ ] Boş bir `baseplate`'ten başlayıp harita 25 saniyeden kısa sürede üretiliyor.
- [ ] Aynı seed → aynı harita (deterministik üretim).
- [ ] Ana menü açılıyor, "OYNA" karakteri spawn ediyor, HUD çalışıyor.
- [ ] Her ayar anında etki ediyor ve yeniden girişte korunuyor.
- [ ] 14 silahın hepsi ateş ediyor/sallanıyor, doğru ses ve efekt veriyor, reload çalışıyor.
- [ ] Yürüme/koşma/çömelme/nişan alma animasyonları geçişli ve takılmasız.
- [ ] Zombiler oyuncuyu görüyor, duyuyor, kovalıyor, saldırıyor ve **ölünce loot düşürüyor**.
- [ ] Kafa vuruşu ×3 hasar veriyor; bacak kopunca zombi sürünüyor.
- [ ] Yağmalanan eşya envantere giriyor, kuşanılabiliyor, yere atılabiliyor.
- [ ] 60 zombi + 4 oyuncu ile FPS ≥ 45, sunucu tick ≤ 15 ms.
- [ ] Eksik asset ID'si olan sistemler **çökmüyor**, uyarı loglayıp devam ediyor.
- [ ] Exploit testi: sahte atış remote'u spam'i kick ile sonuçlanıyor.

---

## 17. Asset Temini Kuralları (ÇOK ÖNEMLİ)

**Uyarı:** Bir yapay zekâ modeli Roblox katalog ID'lerini *ezberden uyduramaz* — uydurulmuş ID'ler
sessiz kalan sesler ve boş modeller üretir. Bu yüzden:

1. **Tüm ID'ler `src/shared/Assets.luau` içinde**, kategorilere ayrılmış ve `0` varsayılanıyla tanımlanır:
   ```lua
   Assets.Sounds.Weapons.Rifle = {
       Mechanical = 0,  -- TODO: Creator Store → Audio → "rifle bolt" 
       Fire       = 0,  -- TODO: "assault rifle shot"
       Tail       = 0,  -- TODO: "gunshot tail forest"
       Distant    = 0,  -- TODO: "distant gunshot"
       Reload     = 0,
       Empty      = 0,
   }
   ```
2. **Fallback zorunlu:** ID `0` ise sistem sessizce atlar, konsola **bir kez** şu uyarıyı yazar:
   `[Assets] Eksik ses: Weapons.Rifle.Fire — ASSETS.md'ye bakın`. Oyun çalışmaya devam eder.
3. **`ASSETS.md` dosyası** şunları içermeli: her slot için önerilen arama terimi (TR + EN),
   nereden bulunacağı (Roblox **Creator Store → Audio/Models**, "Free"/lisanslı filtresi),
   ID'nin nasıl kopyalanacağı (asset sayfası URL'sindeki sayı) ve nereye yapıştırılacağı.
4. **Yalnızca kullanım hakkına sahip olduğun assetleri kullan.** Roblox'un kendi ücretsiz ses
   kütüphanesi, CC0 kaynaklar (freesound.org CC0 filtresi, Pixabay) → kendi hesabına yükle.
   Telifli oyun/film sesi veya markalı model kullanma.
5. **Modeller için tercih sırası:** (a) prosedürel/kodla üretilen geometri (ağaç, ev, prop — asset
   gerektirmez, bu yüzden **varsayılan yöntem budur**), (b) kendi yüklediğin mesh'ler,
   (c) Creator Store'dan lisanslı ücretsiz mesh'ler.
6. **Materyaller:** Roblox'un yerleşik PBR materyalleri (`Concrete`, `Brick`, `WoodPlanks`,
   `CorrodedMetal`, `Rock`, `LeafyGrass`, `Mud`, `Asphalt`) zaten fotogerçekçiye yakındır —
   gerçekçilik için önce bunları ve doğru renk paletini/aydınlatmayı kullan, mesh'e sonra geç.

---

## 18. Teslim Formatı

Ajan her fazın sonunda şunları üretmeli:
1. Tam dosya içerikleri (kısaltma/`...` yok, çalışır kod).
2. Bir sonraki faza geçmeden **kısa bir özet**: ne eklendi, hangi dosyalar değişti, nasıl test edilir.
3. `README.md` güncellemesi: kurulum (`rokit install`, `rojo serve`), Studio'ya bağlanma adımları,
   mimari şeması, dengeleme dosyasının nerede olduğu.
4. Bilinen eksikler listesi (özellikle doldurulmamış asset ID'leri).

---

## 19. Yapılmayacaklar

- *The Walking Dead* logosu, karakter isimleri (Rick, Daryl…), dizi müziği veya görselleri **kullanma**.
  Oyun yalnızca **türden ve atmosferden** ilham alır.
- Aşırı grafik şiddet içeriği ekleme — Roblox topluluk kurallarına uygun kal
  (kan efektleri stilize ve ayarlardan kapatılabilir olmalı).
- Gerçek para/kumar mekaniği, sohbet üzerinden veri toplama yok.
- Uydurma asset ID'si yazma; bilmiyorsan `0` bırak ve `ASSETS.md`'ye not düş.

---

## 20. Fazlara Bölünmüş Uygulama Planı

> Her fazı ayrı prompt olarak ver. Fazın başına **Bölüm 1–4**'ü kopyala, sonra ilgili fazı ekle.

**Faz 0 — İskele:** Rojo projesi, klasör yapısı, `Config`, `Assets` (0 dolgulu), `Net`, `Util/*`,
boş servis kayıtları, README. *Kabul: `rojo serve` çalışıyor, Studio'da hatasız yükleniyor.*

**Faz 1 — Dünya:** `TerrainGen` + `Atmosphere` + gün/gece. *Kabul: seed'li arazi, sis, gece döngüsü.*

**Faz 2 — Yapılar:** `RuinedHouse`, `ForestGen`, `VillageGen`, `RoadGen`, `PropGen`.
*Kabul: 3+ köy, yıkık evler, yoğun orman, 25 sn altı üretim.*

**Faz 3 — Karakter:** `LocomotionController`, `AnimationController`, `CameraController`, stamina.
*Kabul: yürüme/koşma/çömelme/sprint akıcı, prosedürel katman animasyon ID'si olmadan da çalışıyor.*

**Faz 4 — Silahlar:** `Weapons.luau` tablosu, `WeaponController`, `CombatService`, viewmodel,
efektler, 14 silahın tamamı. *Kabul: her silah ateş ediyor/sallanıyor, sunucu doğrulaması aktif.*

**Faz 5 — Ses:** `SoundController`, katmanlı silah sesi, occlusion, reverb, adım sesleri, ortam.
*Kabul: ID'ler boşken bile hata yok; dolu ID'lerle katmanlı ses çalıyor.*

**Faz 6 — Zombiler:** `ZombieFactory`, `ZombieAI`, `Senses`, `HordeDirector`, uzuv hasarı, ragdoll.
*Kabul: 60 zombi performans bütçesinde, duyular çalışıyor, kafa vuruşu ×3.*

**Faz 7 — Loot & Envanter:** `LootService`, `LootTables`, `InventoryService`, konteynerler,
zombi drop'u, `InventoryUI` + `LootUI`. *Kabul: zombi öldür → loot düşüyor → alınıyor → kuşanılıyor.*

**Faz 8 — UI:** `MainMenu`, `SettingsMenu` (tüm sekmeler), `HUD`, `DeathScreen`, yükleme ekranı,
`DataService` ile ayar kalıcılığı. *Kabul: Bölüm 12'deki her ekran ve her ayar çalışıyor.*

**Faz 9 — Cila:** `SurvivalService` (açlık/susuzluk/enfeksiyon), hava durumu, `AntiExploit`,
performans optimizasyonu, crafting (opsiyonel), dengeleme geçişi, tam test listesi (Bölüm 16).

---

## 21. Fazı Başlatırken Kullanılacak Şablon

```
[Bölüm 1–4'ü buraya yapıştır]

Şimdi FAZ <N> — <ad> uygula.
Kapsam: <ilgili bölüm numaraları, örn. "Bölüm 9 ve 15">
Kurallar: Kodu eksiksiz yaz, kısaltma yapma. Her dosyayı tam yolu ile ver.
Bitirince: değişen dosyaların listesi, Studio'da nasıl test edileceği ve
bilinen eksikler (özellikle boş asset ID'leri) ile özet geç.
Faz kabul kriterlerini karşılamadan bir sonraki faza geçme.
```
