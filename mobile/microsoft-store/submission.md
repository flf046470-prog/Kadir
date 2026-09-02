# Microsoft Store'a gönderim

Bu klasördeki dosyaların nereye gittiği, ve paketin nasıl üretildiği.

Android ve iOS'tan farklı olarak burada derlenecek bir native proje **yok**.
FioreMatch zaten yüklenebilir bir PWA — `src/app/manifest.ts`, `public/sw.js`,
`public/icons/` — ve Microsoft Store PWA'ları MSIX olarak kabul ediyor. Windows
için üçüncü bir kabuk yazmak, bakımı olan ve hiçbir şey kazandırmayan bir iş
olurdu.

---

## 0. Abonelikler

Windows'ta abonelik satılabiliyor: `src/lib/billing/microsoft.ts` Store
collections API'sini konuşan bir `PurchaseVerifier`, ve `/api/billing/purchase`
artık gövdede `store` alanı bekliyor (`google_play` | `app_store` |
`microsoft_store`).

Akış iki taraflı, ve iki tarafı da olması bilinçli:

- **İstemci** Windows'tan bir *Store ID key* alır (`StoreContext`) ve `token`
  olarak gönderir. Bu, üyeyi kanıtlar.
- **Sunucu** Azure AD'den kendi adına bir belirteç alır. Bu, yayıncıyı
  kanıtlar.

İkisi olmadan sorgu çalışmıyor — istemci yayıncı belirteci üretemez, sunucu da
istemcinin almadığı bir anahtarla kimseyi adlandıramaz.

### Yapılandırma

Partner Center yayıncı hesabının bulunduğu Azure AD kiracısında bir uygulama
kaydı açın. API izni ya da yanıt URL'si gerekmiyor; tek işi
`client_credentials` ile yayıncıyı kanıtlamak.

```bash
MICROSOFT_STORE_TENANT_ID=...      # Directory (tenant) ID
MICROSOFT_STORE_CLIENT_ID=...      # Application (client) ID
MICROSOFT_STORE_CLIENT_SECRET=...  # istemci gizli anahtarı — süresi doluyor
```

Üçü birden ya da hiçbiri: eksik yapılandırma başlangıçta hata veriyor, sessizce
geri düşmüyor. Aksi hâlde abonelik sattığını sanan ve hepsini reddeden bir
deploy elde edersiniz.

**Ürün kimlikleri.** `PRODUCT_TIERS` (`src/lib/billing/purchase.ts`) şu ikisini
tanıyor:

```
com.fiorematch.app.plus.monthly
com.fiorematch.app.vip.monthly
```

Partner Center'da eklentileri **aynı kimliklerle** oluşturursanız başka bir şey
gerekmiyor. Farklı adlandırdıysanız eşlemeyi verin:

```bash
MICROSOFT_STORE_PRODUCT_IDS='{"com.fiorematch.app.plus.monthly":"9NXXXXXXXXXX"}'
```

Bu eşleme yanlışsa sürücü sorunsuz kimlik doğrular ve hiçbir şey eşleştiremez —
üyeye "satın alman geçersiz" olarak görünür. Test satın almasıyla bir kez
doğrulayın.

### Doğrulanması gereken bir nokta

Sürücünün okuduğu `recurrenceState` alan adı, Microsoft'un dokümantasyonuna
karşı **canlıya çıkmadan doğrulanmalı**. İki uç nokta ve iki adımlı akış
uzun süredir aynı; en çok değişmiş olabilecek şey yanıt alan adları.

Yanlış olması hâlinde davranış kapalı yönde bozuluyor — her satın alma
reddedilir, kimseye bedava abonelik verilmez — ve `interpretRecurrence()`
bu alanları okuyan tek yer, testleri de var. Düzeltmesi tek fonksiyon.

---

## 1. Partner Center hesabı ve ad ayırma

1. <https://partner.microsoft.com/dashboard> üzerinden geliştirici hesabı açın.
   Tek seferlik bir kayıt ücreti var (bireysel ve şirket için farklı; güncel
   tutarı kayıt ekranı gösteriyor).
2. **Apps and games → New product → EXE or MSIX app**.
3. Ürün adını ayırın: `FioreMatch`.

Ad ayrıldığı anda paketin kimliği belirleniyor. Bu değerler PWABuilder'a
girilecek, ve **sonradan değiştirilemez**:

**Product identity** sayfasından (Partner Center → ürün → Product management →
Product identity):

| Partner Center'daki ad | PWABuilder'daki alan | Örnek |
| --- | --- | --- |
| Package/Identity/Name | Package ID | `12345Publisher.FioreMatch` |
| Package/Identity/Publisher | Publisher ID | `CN=ABCDEFAB-1234-...` |
| Package/Properties/PublisherDisplayName | Publisher display name | `FioreMatch` |

Bu üçünü yanlış girerseniz paket yüklenir ama Partner Center "bu paketin
kimliği bu ürünle eşleşmiyor" diyerek reddeder — ve hata mesajı hangi alanın
yanlış olduğunu söylemez.

---

## 2. MSIX'i üretme

Site canlıda olmalı: PWABuilder manifesti ve service worker'ı URL'den okur.

1. <https://www.pwabuilder.com> → `https://fiorematch.com` adresini girin.
2. Rapor ekranında manifest, service worker ve güvenlik başlıklarının geçtiğini
   doğrulayın. Manifest zaten `id`, `lang`, `dir`, `screenshots` ve her iki
   `form_factor` için ekran görüntüleri içeriyor — bunlar PWABuilder'ın
   puanladığı alanlar ve `src/app/manifest.ts` içinde bilerek duruyorlar.
3. **Package for stores → Windows → Generate package**.
4. Yukarıdaki tablodaki üç değeri girin.
5. Üretilen `.msixbundle` dosyasını indirin.

### Üretileni doğrulayın

PWABuilder ikonları 512'likten kendi türetiyor. Bu klasördeki
`assets/msix/` içindekiler **aynı marka işaretinden, bizim kırpma
oranlarımızla** üretilmiş 45 dosya. Paketin içindekileri bunlarla
karşılaştırmak isterseniz `.msixbundle` bir zip:

```bash
unzip -l FioreMatch.msixbundle
```

Beklenen ölçüler `assets.mjs` içinde tablo hâlinde yazılı. Paketteki ikonlar
bulanık ya da yanlış kırpılmışsa `assets/msix/` içindekilerle değiştirip
yeniden paketleyin.

`BackgroundColor` `#fff5f7` olmalı — kutucukların arkasına çizilen renk bu, ve
markanın zemini bu.

---

## 3. Listeleme

`listing.md` dosyasındaki her alan Partner Center'daki karşılığına yapıştırılır.
Ekran görüntüleri:

```
assets/screenshots/     → Store listings → Screenshots  (5 adet, 1366×768)
assets/listing/store-logo-300.png → Store logos → 300×300
```

Ekran görüntüleri **masaüstü** çekimleri, telefon çekimlerinin büyütülmüşü
değil — `mobile/captures-desktop/` klasöründen geliyorlar ve Microsoft'un
1366×768 alt sınırını sağlıyorlar. Play ve App Store'un kullandığı 1080×1920
telefon çekimleri buraya **yüklenmemeli**: hem sınırın altında kalıyorlar hem
de masaüstü mağaza sayfasında telefon çekimi olduğu belli oluyor.

Üretmek için:

```bash
npm run capture              # her iki şekilde çeker
npm run store:microsoft      # bu klasörün assets/ dizinini yazar
```

---

## 4. Yaş sınıflandırması ve politikalar

`listing.md`'deki "Yaş sınıflandırması" bölümüne bakın. IARC anketi **Play'deki
sertifikadan bağımsız** — yeniden doldurulması gerekiyor.

Gönderimden önce yayında olması gerekenler:

- `https://fiorematch.com/tr/privacy` — gizlilik politikası (zorunlu alan)
- `https://fiorematch.com/tr/terms` — kullanım koşulları

İnceleme sırasında açılmayan bir bağlantı doğrudan reddedilme sebebi.

---

## 5. İnceleme sırasında sorulacaklar

Bir flört uygulaması için inceleme, ortalama bir uygulamadan daha ayrıntılı.
Hazır olması gerekenler:

- **Test hesabı.** İncelemeyi yapan kişi kayıt olmadan içeriği göremiyor.
  Partner Center'ın *Notes for certification* alanına çalışan bir e-posta ve
  parola bırakın, ve o hesapta görülecek bir şey olsun — boş bir Keşfet
  ekranı "uygulama çalışmıyor" olarak raporlanıyor.
- **Kullanıcı içeriği moderasyonu.** Uygulamada engelleme ve bildirme var,
  moderasyon ekranı da var (`/app/moderation`). Nerede olduklarını notlara
  yazın.
- **Çeviri üçüncü tarafa gidiyor.** Mesajların bir çeviri sağlayıcısına
  gönderildiği hem uygulama içinde (sohbetin üstündeki bilgilendirme) hem
  gizlilik politikasında yazılı. İnceleme bunu sorarsa cevap ikisinde de var.

---

## Bilinen zayıflık: geniş pencerede yerleşim

1366×768'de Keşfet kartı `max-w-xl` ile sınırlı ve sola yaslı; pencerenin sağ
yarısı boş kalıyor. Reddedilme sebebi değil, ama mağaza sayfasındaki ekran
görüntüsünde görünüyor ve "telefon uygulamasının pencereye konmuş hâli"
izlenimi veriyor.

`mobile/captures-desktop/01-kesfet.png` dosyasına bakın — sorun orada net
görünüyor. Düzeltmesi masaüstü kırılma noktası için bir yerleşim değişikliği;
bu gönderimi bloke etmiyor, ama Windows'u ciddiye alacaksanız yapılacaklar
listesinde.
