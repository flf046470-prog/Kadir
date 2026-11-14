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
| İmza anahtarı | **Oluşturuldu** (RSA 4096, 10000 gün, takma ad `derinlik`). Dosya ve parola sende; depoda yalnızca herkese açık parmak izi var (`signing.json`). |
| `assetlinks.json` | `make_quest.py` her çalıştığında `signing.json`'dan üretir. |
| APK paketleme | **Denendi:** geçici bir test anahtarıyla bubblewrap 1.24.1 APK ve AAB üretti. Paket kontrolü: `immersive` modu, `com.oculus.intent.category.VR`, minSdk 29, targetSdk 32, tek izin `HAND_TRACKING`, imza anahtarla aynı (APK Signature Scheme v3). Test anahtarı ve APK depoda değil; gerçek paket senin anahtarınla yeniden üretilecek. |
| Markalı görseller | Meta'nın güncel ölçüleriyle → `art/` (`node DerinlikSteam/tools/compose.mjs --only meta`): hero 3000×900, yatay kapak 2560×1440, kare 1440×1440, dikey 1008×1440, mini yatay 1080×360, fragman kapağı 2560×1440, şeffaf logo, ikon 512, uzamsal ikon (arka plan + ön plan 180). Üzerlerinde yalnızca "DERİNLİK" yazar (Meta: başlık birebir, slogan yok). |
| 360 önizleme | `art/preview360_equirect_7680x3840.jpg` (1,6 MB; sınır 2,3 MB): Paris'teki mühür odası, oyunun kendi motoruyla, göz yüksekliği 1,7 m, başlık yazısı ve karakter yok (`tools/preview360.mjs` + `.py`). Meta'nın "içerik 10 m uzakta" önerisi bu yeraltı mekânında karşılanamıyor; en yakın kaide ~4 m. |
| Mağaza metni | `store-text-meta.md` (ad, kısa ve uzun açıklama, konfor derecesi, IARC cevapları) |
| Ekran görüntüleri (5 × 2560×1440) | `art/screenshots/`: oyunun kendi motorundan, oyuncunun gözünden, VR'daki görünümle (Düşük kalite, son işleme yok, ekran yazısı yok) (`META=1 node DerinlikSteam/tools/capture.mjs …`). Meta "oyun içi içerik" istiyor; gözlükte çekilmiş görüntüyle değiştirmek istersen `metavr capture screenshot`. |
| Fragman | Steam fragmanı v3 doğrudan kullanılabilir: 1920×1080, 61,4 s, H.264/AAC (Meta: 1080p–2K, 30 s–2 dk). Başka platform logosu ya da donanım göstermiyor. Video ~140 MB, depoda değil (`DerinlikSteam/README.md`'deki komutlarla yeniden üretilir). |
| Performans (Quest 2'de 72 Hz, Quest 3'te 90 Hz) | **Ölçülmedi.** Bu ortamda gerçek GPU yok. VR'da kalite otomatik "Düşük"e iner ve son işleme kapanır. |

## Senin yapman gerekenler (hesap ve izin gerektirir)

1. **Meta geliştirici hesabı ve uygulama:** developers.meta.com/horizon → organizasyon → *Create New App* (Quest).
   Buradan **App ID** (sayı) ve *API* sekmesinden **App Secret** alınır. İlk yüklemeden önce organizasyon yöneticisi
   *Developer Distribution Agreement*'ı (DDA) bir kez imzalamalı.
2. **Herkese açık HTTPS adresi:** `web/` klasörü bir yerde yayında olmalı (ör. yeni bir Vercel projesi, kök dizini
   `DerinlikQuest/web`). bubblewrap manifest ve ikonları bu adresten indirir. Deploy korumalı (401 veren) adres olmaz;
   projenin herkese açık `*.vercel.app` adresi ya da kendi alan adın.
3. **İmza anahtarı:** oluşturuldu ve sana gönderildi (`derinlik-quest.keystore` + `ANAHTAR-BILGILERI.txt`).
   Kalıcıdır: sonraki her güncelleme aynı anahtar ve aynı paket adıyla (`com.derinlik.quest`) imzalanmak zorunda;
   kaybolursa mağazada yeni uygulama açmak gerekir. İki ayrı güvenli yerde yedekle; depoya ya da `web/` içine koyma.
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
  --keystore <yol>/derinlik-quest.keystore
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
