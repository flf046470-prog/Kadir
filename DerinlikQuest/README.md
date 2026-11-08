# DERİNLİK — Meta Quest (Horizon Store)

Oyunun Quest sürümü ayrı bir oyun değil: aynı çevrimdışı oyun sayfası, kurulabilir bir web uygulaması (PWA) olarak
yayınlanır; Meta'nın `bubblewrap` aracı bu canlı sayfayı imzalı bir APK'ya (Trusted Web Activity) sarar. Mağazadan
kurulan uygulama açılınca oyun doğrudan gözlüğe girer (`DerinlikWeb/src/fx-xr.js`: yalnızca kurulu uygulamada var olan
`getDigitalGoodsService` görülünce), kayıt varsa kaldığı yerden devam eder. Tarayıcı sekmesinde ise başlangıç ekranı ve
"VR'da oyna" düğmesi kalır.

## Durum

| | Durum |
|---|---|
| VR oynanış (WebXR) | Hazır; Meta'nın Quest 3 emülatöründe (IWER) test edildi. **Gerçek gözlükte denenmedi.** |
| Kurulu uygulamada otomatik VR'a giriş | Hazır; emülatörde `?autovr` ile test edildi. Asıl yolu (`getDigitalGoodsService`) yalnızca gözlükte denenebilir. |
| Web uygulaması: manifest, ikonlar, gizlilik sayfası | Hazır → `public/`; `make_quest.py` `web/` klasörüne derler. Chrome manifest'i hatasız okuyor. |
| `twa-manifest.json` (bubblewrap girdisi) | `make_quest.py --host …` üretir (`horizonOSAppMode: "immersive"`). |
| `assetlinks.json` | `make_quest.py --fingerprint …` üretir; imza anahtarı oluşunca. |
| APK paketleme | **Denendi:** geçici bir test anahtarıyla bubblewrap 1.24.1 APK ve AAB üretti. Paket kontrolü: `immersive` modu, `com.oculus.intent.category.VR`, minSdk 29, targetSdk 32, tek izin `HAND_TRACKING`, imza anahtarla aynı (APK Signature Scheme v3). Test anahtarı ve APK depoda değil; gerçek paket senin anahtarınla yeniden üretilecek. |
| Mağaza görselleri | Uygulama ikonu 1024, hero 2560×1440 (yazı iç %80'de), küçük yatay 1280×720 → `art/` (`node DerinlikSteam/tools/compose.mjs --only meta`) |
| Mağaza metni | `store-text-meta.md` (ad, kısa ve uzun açıklama, konfor derecesi, IARC cevapları) |
| Ekran görüntüleri (en az 3, 2560×1440) | **Yok.** Meta gözlükte çekilmiş gerçek görüntü istiyor (`metavr capture screenshot`); masaüstü ekran görüntüsü reddedilir. |
| Fragman | İsteğe bağlı; Steam fragmanı (1080p, 61 s) kullanılabilir, Meta 30–60 s öneriyor → kısaltılmış kesim gerekebilir. |
| Performans (Quest 2'de 72 Hz, Quest 3'te 90 Hz) | **Ölçülmedi.** Bu ortamda gerçek GPU yok. VR'da kalite otomatik "Düşük"e iner ve son işleme kapanır. |

## Senin yapman gerekenler (hesap ve izin gerektirir)

1. **Meta geliştirici hesabı ve uygulama:** developers.meta.com/horizon → organizasyon → *Create New App* (Quest).
   Buradan **App ID** (sayı) ve *API* sekmesinden **App Secret** alınır. İlk yüklemeden önce organizasyon yöneticisi
   *Developer Distribution Agreement*'ı (DDA) bir kez imzalamalı.
2. **Herkese açık HTTPS adresi:** `web/` klasörü bir yerde yayında olmalı (ör. yeni bir Vercel projesi, kök dizini
   `DerinlikQuest/web`). bubblewrap manifest ve ikonları bu adresten indirir. Deploy korumalı (401 veren) adres olmaz;
   projenin herkese açık `*.vercel.app` adresi ya da kendi alan adın.
3. **İmza anahtarı:** kalıcıdır; sonraki her güncelleme aynı anahtar ve aynı paket adıyla (`com.derinlik.quest`)
   imzalanmak zorunda. Kaybolursa mağazada yeni uygulama açmak gerekir. Elinde bir anahtar varsa onu, yoksa yenisini
   oluştur ve **web klasörünün dışında**, yedekli sakla:

   ```sh
   keytool -genkeypair -v -keystore ~/derinlik-keys/derinlik.keystore -alias derinlik \
     -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DERINLIK, O=<şirket ya da adın>, C=TR"
   keytool -list -v -keystore ~/derinlik-keys/derinlik.keystore -alias derinlik | grep SHA256
   ```
4. **Gözlükte deneme:** APK'yı gözlüğe yükleyip (geliştirici modu) bütün oyunu bir kez oyna; kare hızına ve 15 dakika
   boyunca çökme olmamasına bak, mağaza ekran görüntülerini orada çek.
5. **Mağaza sayfası:** `store-text-meta.md` ve `art/` içeriğini panele gir, IARC anketini doldur, fiyatı belirle,
   `public/privacy.html` içindeki `[support e-mail]` yerine destek adresini yaz.

## Sıra (komutlar depo kökünden)

```sh
# 1. web uygulaması (oyun + manifest + ikonlar + gizlilik)
python3 DerinlikQuest/make_quest.py
# → DerinlikQuest/web/ : bunu yayınla, sonra https://<ALAN>/manifest.webmanifest 200 dönmeli

# 2. anahtar hazır olunca: assetlinks + bubblewrap girdisi
python3 DerinlikQuest/make_quest.py --skip-build --host <ALAN> --app-id <APP_ID> \
  --keystore ~/derinlik-keys/derinlik.keystore --fingerprint <SHA256, iki nokta ayrımlı>
# → web/.well-known/assetlinks.json (tekrar yayınla) ve DerinlikQuest/twa/twa-manifest.json

# 3. APK  (JDK 17 ve Android SDK gerekir: build-tools;34.0.0 + platforms;android-36; bubblewrap SDK klasöründe
#    eski "tools" adını arar → cmdline-tools/latest'e "tools" bağlantısı yeterli)
npm i -g @meta-quest/bubblewrap-cli
printf '{"jdkPath":"/usr/lib/jvm/java-17-openjdk-amd64","androidSdkPath":"<SDK>"}' > ~/.bubblewrap/config.json
cd DerinlikQuest/twa
export BUBBLEWRAP_KEYSTORE_PASSWORD=… BUBBLEWRAP_KEY_PASSWORD=…
bubblewrap update && bubblewrap build          # → app-release-signed.apk
apksigner verify --print-certs app-release-signed.apk | grep SHA-256   # anahtarınkiyle aynı olmalı

# 4. yükleme (önce ALPHA kanalı)
ovr-platform-util upload-quest-build --app-id <APP_ID> --app-secret <SECRET> \
  --apk app-release-signed.apk --channel ALPHA --age-group TEENS_AND_ADULTS --notes "DERİNLİK alpha"
```

Yalnızca web tarafı değiştiğinde (oyun güncellemesi) `web/`'i yeniden yayınlamak yeter; kurulu uygulama bir sonraki
açılışta yeni sürümü yükler. APK'yı yeniden üretip yüklemek yalnızca ad, ikon, sürüm, paket ya da uygulama modu
değişince gerekir (her yüklemede `--version` bir artmalı).

**Güvenlik:** anahtar dosyası ve App Secret hiçbir zaman `web/` içine ya da depoya girmez (`.gitignore` `*.keystore`,
`web/`, `twa/` dışarıda tutar). Yayından sonra `https://<ALAN>/derinlik.keystore` 404 dönmeli.

## Test

```sh
# emülatörde: manifest, ikonlar, gizlilik sayfası, tarayıcıda başlangıç ekranı, ?autovr ile tıklamasız VR'a giriş
cd DerinlikQuest && npm install && cd .. && node DerinlikQuest/test_pwa.mjs
```
