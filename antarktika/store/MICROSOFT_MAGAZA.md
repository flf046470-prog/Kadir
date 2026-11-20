# Microsoft Store — ANTARKTIKA: WHITEOUT

Oyunun Windows sürümü (`steam/`, Electron) Microsoft Store'a **paketli masaüstü uygulaması (AppX/MSIX)** olarak
gönderilir ve **ücretli** satılabilir. Paket Windows'ta üretilir: `.github/workflows/windows-store.yml`
her değişiklikte GitHub'ın Windows makinesinde paketi kurar, oyunun açılıp dünyayı yüklediğini test eder ve
iki dosya bırakır: `microsoft-store-appx` (mağaza paketi) ve `steam-win64` (Steam için Windows sürümü).

## 1. Partner Center (sizin hesabınız)

1. https://partner.microsoft.com → Windows & Xbox geliştirici hesabı (bireysel hesap ücretsiz).
2. **Uygulama oluştur → Ad ayır:** `ANTARKTIKA: WHITEOUT` (ya da Türkçe/İngilizce varyantı).
3. **Ürün yönetimi → Ürün kimliği** sayfasındaki üç değeri GitHub'a **depo değişkeni** olarak girin
   (Settings ▸ Secrets and variables ▸ Actions ▸ *Variables* — gizli değil, kimlik bilgisi değildir):

   | GitHub değişkeni | Partner Center alanı |
   | --- | --- |
   | `MSSTORE_IDENTITY_NAME` | Package/Identity/Name |
   | `MSSTORE_PUBLISHER` | Package/Identity/Publisher (`CN=...`) |
   | `MSSTORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName |

4. Actions ▸ **windows-store** ▸ *Run workflow*. Bittiğinde `microsoft-store-appx` dosyasını indirin;
   içindeki `.appx` paketi Partner Center ▸ **Paketler** adımına yüklenir. İmza gerekmez: Mağaza paketi
   kendi sertifikasıyla imzalar. Değişkenler girilmeden üretilen paket yer tutucu kimlik taşır ve
   yüklemede reddedilir.

## 2. Gönderim formu

| Alan | Değer |
| --- | --- |
| Kategori | Oyunlar ▸ Macera (alt: Bulmaca) |
| Fiyat | Ücretli — kademe sizin kararınız. Uygulama içi satın alma yok |
| Ücretsiz deneme | İsteğe bağlı (süreli deneme) |
| Yaş derecelendirmesi | IARC anketi formda doldurulur. İçerik: silah kullanımı yok, kan yok; karanlık/gerilim, dronlardan saklanma |
| Gizlilik politikası URL'si | Sitedeki `/gizlilik/` sayfası (site yayınlanınca tam adres) |
| Destek URL'si | Sitedeki `/destek/` sayfası |
| Sistem gereksinimleri | Windows 10 1809+ x64 · DirectX 11/12 GPU · 4 GB RAM · 500 MB disk |
| Kısıtlı yetenek `runFullTrust` | Açıklama: "Electron tabanlı masaüstü oyun; oyun dosyalarını yalnızca kendi paketinden, yerel bir döngü sunucusundan yükler. Ağ erişimi, dosya sistemi erişimi veya ek sürücü yok." |
| Dil | Türkçe (birincil), İngilizce |

Mağaza metni: App Store / Steam metinleriyle aynı (`docs/APP_STORE_METIN.md`, `store/STEAM_MAGAZA.md`).

## 3. Görseller (`store/microsoft/listing/`)

Ölçüler Microsoft Learn "App screenshots, images, and trailers for MSIX app" sayfasından (2026-11-20).

| Dosya | Partner Center alanı |
| --- | --- |
| `poster_2x3_1440x2160.png` | 2:3 Poster art — oyunlarda ana logo, başlık içerir |
| `boxart_1x1_2160x2160.png` | 1:1 Box art, başlık içerir |
| `tile_icon_300x300.png` | 1:1 App tile icon |
| `superhero_16x9_3840x2160.png` | 16:9 Super hero art — fragmanın sayfanın üstünde görünmesi için gerekli |
| `screenshots/01–10.png` | Masaüstü ekran görüntüleri, PNG, 1920x1080 |
| `trailer_thumbnail_1920x1080.png` + `store/steam/trailer_1080p.mp4` | Fragman (MP4, 1920x1080, 34 sn) ve küçük resmi |

Paketin içindeki karo görselleri `steam/build/appx/` klasöründe (StoreLogo, 44, 150, 310x150, küçük/büyük
karo, açılış ekranı). Hepsi `python3 tools/make_msstore_kit.py` ile yeniden üretilir.

## 4. Bilinen durumlar

- Paket bu Linux ortamında üretilemiyor (Microsoft'un paketleme araçları yalnızca Windows'ta çalışıyor);
  üretim ve test GitHub Actions'ın Windows makinesinde yapılıyor.
- Paket imzasız: yerelde kurup denemek için Windows'ta *Geliştirici modu* gerekir
  (`Add-AppxPackage -Register` ile açılmış klasörden) ya da test sertifikasıyla imzalanmalıdır.
- Kayıtlar `%LOCALAPPDATA%\Packages\<paket>\` altında tutulur; kaldırınca silinir.
- VR (`--vr`) Mağaza sürümünde kullanılmaz; Mağaza sürümü fare/klavye ve oyun kumandasıyla oynanır.
