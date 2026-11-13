# Steam mağaza sayfası — metinler, görseller, yapılacaklar

Ölçüler ve kurallar Steamworks belgelerinden (13.11.2026'da okundu):
`partner.steamgames.com/doc/store/assets/standard`, `/libraryassets`, `/rules`, `/doc/store/trailer`.

## 1. Görseller (`store/steam/`)

| Steamworks alanı | Dosya | Boyut | Kural |
| --- | --- | --- | --- |
| Header Capsule | `header_capsule_920x430.png` | 920×430 | Yalnızca görsel + oyun logosu |
| Small Capsule | `small_capsule_462x174.png` | 462×174 | Logo kapsülü neredeyse doldurmalı |
| Main Capsule | `main_capsule_1232x706.png` | 1232×706 | Yalnızca görsel + logo |
| Vertical Capsule | `vertical_capsule_748x896.png` | 748×896 | Yalnızca görsel + logo |
| Page Background | `page_background_1438x810.png` | 1438×810 | Sakin, metinsiz |
| Library Capsule | `library_capsule_600x900.png` | 600×900 | Logo şart, başka metin yok |
| Library Header | `library_header_920x430.png` | 920×430 | Logo okunaklı |
| Library Hero | `library_hero_3840x1240.png` | 3840×1240 | **Hiç metin yok**; ana öge ortadaki 860×380 güvenli alanda |
| Library Logo | `library_logo_1280.png` | 1280 px genişlik | Şeffaf PNG, yalnızca logotip |
| Screenshots | `screenshots/01…10.png` | 1920×1080 | En az 5; yalnızca oynanış. En az 4'ünü "her yaşa uygun" işaretleyin |
| Trailer | `trailer_1080p.mp4` | 1920×1080, 30 fps, H.264 + AAC 48 kHz, ≥5000 kb/sn | İlk video mikro-fragmana dönüştürülür |

Kapsüllerdeki görseller Blender Cycles ile oyunun kendi modellerinden render edildi (`blender/scripts/render_keyart.py`);
ekran görüntüleri oyun motorundan alındı (`tools/capture_stills.cjs --size 1920x1080 --dsf 1 --touch off`).

## 2. Mağaza metni

**Ad:** ANTARKTIKA: WHITEOUT

**Kısa açıklama (≤300 karakter, TR):**
2091, Antarktika. HELIKON-14 istasyonu 03:17'de sustu. Yedi bölümde buzun altındaki şehre in, onun enerjisiyle kışı atlat, termal dronlardan silahsız saklan. Seçimlerin üç sondan birini getirir. Masaüstünde ve VR'da oynanır.

**Short description (EN):**
Antarctica, 2091. Station HELIKON-14 went silent at 03:17. Across seven chapters, descend to a city under the ice, survive the polar night on its power and slip past thermal drones — unarmed. Your choices lead to one of three endings. Play on desktop or in VR.

**Hakkında (TR):**

86° Güney. Buzulun üstünde kalan son mühendis sensin; telsizde kendi sesin yankılanıyor.

- **Yedi bölüm, üç son.** Kime güvendiğin, kimi kurtardığın, ne kadar enerji çektiğin finali belirler: Antlaşma, Mühür ya da Döngü.
- **Altı mekân.** Araştırma istasyonu, buz mağarası, taş salon, buz altı gölündeki şehir, iletim galerisi ve sondaj kampı.
- **Silahsız gerilim.** Termal dronlar sıcak olanı uzaktan görür. Soğuk kal, kar duvarlarının arkasından ilerle.
- **Gerçek dünyadan bulmacalar.** İki elektrik şebekesini senkronoskopla eşle; sondaj pompasını su darbesi yaratmadan durdur; altı sembollü kristal dilini çöz.
- **Gerçekçi zemin.** Antarktika Antlaşması, Madrid Protokolü, buz altı gölleri ve kış lojistiği hikâyenin omurgası.
- **VR isteğe bağlı.** Aynı oyun fare-klavye, oyun kumandası ya da SteamVR başlığıyla oynanır.
- **Tamamen çevrimdışı.** Hesap yok, reklam yok, veri toplama yok.

**About (EN):** aynı maddelerin İngilizcesi: Seven chapters, three endings · Six locations · Unarmed tension (thermal drones see warm bodies from farther away) · Puzzles from the real world (synchronise two power grids, stop a drilling pump without water hammer, learn a six-symbol crystal language) · Grounded fiction (Antarctic Treaty, Madrid Protocol, subglacial lakes) · Optional VR · Fully offline.

**Etiket önerileri:** Adventure, Exploration, First-Person, Atmospheric, Story Rich, Puzzle, Walking Simulator, Sci-fi, Mystery, Multiple Endings, VR, Singleplayer, Stealth, Survival, Choices Matter

**Tür:** Macera, Bağımsız · **Oyuncu:** Tek oyunculu · **Diller:** Arayüz ve altyazı Türkçe (oyun metinleri şu an yalnızca Türkçe)

**VR desteği (dürüst beyan):** "VR Supported" (zorunlu değil). Oturarak/ayakta; hareket sol çubukla, dönüş kademeli. SteamVR ile bu ortamda **denenmedi** (aşağıya bakın).

## 3. İçerik anketi için bilgiler

Şiddet: ekranda yok, oyuncu silahsız · Kan: yok · Korku: hafif gerilim · Dil: temiz · Uyuşturucu/alkol/kumar: yok ·
Çevrimiçi etkileşim: yok · Yapay zekâ beyanı: kod, modeller ve görseller geliştirici tarafından yapay zekâ yardımıyla üretildi
(Steam'in "AI Generated Content" bölümünde "pre-generated" olarak beyan edilmeli).

## 4. Sistem gereksinimleri — ÖLÇÜLMEDİ

Bu depoda yalnızca yazılımsal WebGL (SwiftShader) ile test yapıldı; gerçek GPU'da FPS ölçülmedi. Aşağıdakiler ölçüm değil, başlangıç
taslağıdır ve yayından önce gerçek donanımda doğrulanmalıdır:
Windows 10/11 64 bit · WebGL 2 destekli herhangi bir ayrık ya da tümleşik GPU · 4 GB RAM · 300 MB disk.

## 5. Paket (`steam/`)

`steam/main.js` bir Electron kabuğudur: oyunu yerel (127.0.0.1) bir sunucudan açar, dış ağ isteklerini engeller, kaydı kullanıcı
profilinde tutar. `--vr` ile dünya yüklenince WebXR oturumuna girer.

```
cd antarktika/steam
npm install
npm start            # masaüstü
npm run start:vr     # SteamVR (OpenXR çalışma zamanı SteamVR olmalı)
npm run dist:win     # out/win-unpacked → SteamPipe deposuna yüklenecek klasör
```

**Bu ortamda yapılamayanlar / sizin yapacaklarınız**
- [ ] Windows'ta `npm install && npm start` ile kabuğu çalıştırmak (burada Electron indirilip çalıştırılmadı)
- [ ] SteamVR ile `--vr` denemesi (Chromium'un OpenXR arka ucu; başlık gerekir)
- [ ] Steamworks hesabı, 100 USD Steam Direct ücreti, App ID; `steam_appid.txt` ve SteamPipe yüklemesi
- [ ] Steam Cloud: Auto-Cloud kökü `%APPDATA%/ANTARKTIKA WHITEOUT` (Electron userData)
- [ ] Gerçek GPU'da FPS ölçümü ve sistem gereksinimlerinin yazılması
- [ ] İngilizce oyun içi metin (şu an yok); yoksa mağazada dil olarak yalnızca Türkçe işaretlenmeli
