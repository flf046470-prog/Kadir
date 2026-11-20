# Meta Horizon Store (Quest) — metinler, görseller, paketleme

Ölçüler ve kurallar Meta'nın "Asset design guidelines" sayfasından (13.11.2026'da okundu):
`developers.meta.com/horizon/resources/asset-guidelines`.

## 1. Görseller (`store/meta/`)

| Alan | Dosya | Boyut | Kural |
| --- | --- | --- | --- |
| Hero Cover | `hero_cover_3000x900.png` | 3000×900 | 24 bit PNG; kapaklarla aynı tasarım |
| Cover Landscape | `cover_landscape_2560x1440.png` | 2560×1440 | Başlık güvenli alanda, köşede metin yok |
| Cover Square | `cover_square_1440x1440.png` | 1440×1440 | |
| Cover Portrait | `cover_portrait_1008x1440.png` | 1008×1440 | |
| Mini Landscape | `mini_landscape_1080x360.png` | 1080×360 | |
| Logo (Transparent) | `logo_transparent.png` | 4000 px genişlik (üst sınır 9000×1440) | 32 bit PNG |
| Icon | `icon_512.png` | 512×512 | Dolu, köşeleri kare, şeffaflık yok |
| Spatialized Icon | `spatial_icon_background_180.png`, `spatial_icon_foreground_180.png` | 180×180 | Ön katman şeffaf, gölge eklenmedi |
| Screenshots | `screenshots/01…06.png` | 2560×1440 | 5 adet, oynanış bakışından; afiş/başlık/metin yok |
| Trailer | `trailer_1080p.mp4` | 1920×1080, H.264/AAC, 30 sn – 2 dk | Logo yalnızca başta ve sonda |
| Trailer Cover | `trailer_cover_2560x1440.png` | 2560×1440 | |
| 360 Preview | `preview_360_equirect_7680x3840.jpg` | 7680×3840, JPEG ≥80 kalite, ≤2,3 MB | Başlık/metin yok; kamera yerden 1,67 m |

Meta kuralı: kapaklardaki başlık, uygulamanın adıyla **birebir aynı** olmalı. Görsellerdeki logotip "ANTARKTIKA / WHITEOUT" (iki satır);
mağazada uygulama adını **ANTARKTIKA WHITEOUT** olarak girin (iki nokta olmadan) ya da incelemede sorun çıkarsa logoyu ona göre güncelleyin.
Ekran görüntüleri oyun motorunun masaüstü görünümünden, arayüz gizlenerek alındı; başlık içinden çekilmiş VR karesi **değildir** —
gönderimden önce Quest'te `metavr`/başlık kaydıyla gerçek kareler almanız önerilir.

## 2. Mağaza metni

**Ad:** ANTARKTIKA WHITEOUT
**Kısa açıklama (TR):** 2091. İstasyon 03:17'de sustu. Buzun altındaki şehre in, kışı atlat, dronlardan silahsız saklan. Yedi bölüm, üç son.
**Short description (EN):** Station HELIKON-14 went silent at 03:17. Descend to a city under the Antarctic ice, survive the polar night and slip past thermal drones, unarmed. Seven chapters, three endings.
**Uzun açıklama:** `STEAM_MAGAZA.md` içindeki "Hakkında" metni (VR maddesi: "Başlıkla ayakta ya da oturarak oynanır; sol çubuk yürüyüş, sağ çubuk kademeli dönüş").
**Kategori:** Games ▸ Adventure / Puzzle · **Oyuncu modu:** Single User · **Oynama biçimi:** Sitting, Standing · **İnternet:** Not required after download
**Konfor:** Yapay yürüyüş içerdiği için "Moderate" beyan edin (Meta'nın comfort rating anketi).
**Yaş grubu (upload):** içerik anketini kendiniz doldurun; ekranda şiddet yok, hafif gerilim var.

## 3. Paketleme: sürükleyici PWA → imzalı APK

Oyun bir WebXR uygulaması; Quest mağazasına "immersive PWA" olarak girer (Meta'nın `@meta-quest/bubblewrap-cli` yolu).
Depoda hazır olanlar:

- `ios/Antarktika/Game/js/xr.js` — kurulu uygulamada (yalnızca orada var olan `getDigitalGoodsService` ile) dünya yüklenince VR oturumuna kendiliğinden girer
- `quest/manifest.webmanifest`, `quest/icons/` — kurulabilir PWA bildirimi ve simgeler
- `quest/twa-manifest.json` — `"horizonOSAppMode": "immersive"`; `<DOMAIN>`, paket adı, anahtar yolu yer tutucu
- `quest/assetlinks.template.json` — Digital Asset Links şablonu
- `tools/build_web.py` — barındırılacak statik siteyi `dist/web/` altına derler

**Sıra (her adım bir öncekine bağlı):**

1. `python3 tools/build_web.py` → `dist/web/` klasörünü **ayrı bir Vercel projesi** olarak yayınlayın (kök = bu klasör). Kalıcı takma ad `<DOMAIN>` olur.
   `curl -I https://<DOMAIN>/manifest.webmanifest` → 200 ve `application/manifest+json`.
2. İmza anahtarı: **kalıcıdır**, her güncelleme aynı anahtarla imzalanır. Anahtarı depo dışında üretin/saklayın, yedekleyin. (Bu adımı bilerek size bıraktım.)
3. `quest/twa-manifest.json` içindeki `<DOMAIN>`, `packageId`, `signingKey`, `applicationId` (Horizon App ID) alanlarını doldurun;
   `bubblewrap update && bubblewrap build` → `app-release-signed.apk`.
4. `apksigner verify --print-certs` ile SHA-256'yı alın, `quest/assetlinks.json` dosyasını şablondan oluşturun, `build_web.py`'yi yeniden çalıştırıp yayınlayın.
   `https://<DOMAIN>/.well-known/assetlinks.json` canlı olmadan uygulama **açılmaz**.
5. APK'yı gerçek bir Quest'e kurup deneyin (`metavr app install`), sonra `ovr-platform-util upload-quest-build --channel ALPHA`.
   İlk yüklemede kuruluş yöneticisinin Developer Distribution Agreement'ı imzalaması gerekir.

**Bu ortamda yapılmayanlar:** barındırma (yeni bir Vercel projesi açmak sizin kararınız), imza anahtarı, APK derlemesi, Quest üzerinde deneme,
performans ölçümü (Quest'te hedef 72 FPS — **ölçülmedi**), VRC (Virtual Reality Check) uyum denetimi.
