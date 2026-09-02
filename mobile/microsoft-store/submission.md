# Microsoft Store'a gönderim

Bu klasördeki dosyaların nereye gittiği, ve paketin nasıl üretildiği.

Android ve iOS'tan farklı olarak burada derlenecek bir native proje **yok**.
FioreMatch zaten yüklenebilir bir PWA — `src/app/manifest.ts`, `public/sw.js`,
`public/icons/` — ve Microsoft Store PWA'ları MSIX olarak kabul ediyor. Windows
için üçüncü bir kabuk yazmak, bakımı olan ve hiçbir şey kazandırmayan bir iş
olurdu.

---

## 0. Önce: bu gönderimi bloke eden bir şey var

**Windows'ta abonelik satılamıyor.** `src/lib/billing/purchase.ts` iki
sağlayıcı tanıyor — `google_play` ve `app_store` — ve Microsoft için bir
`PurchaseVerifier` uygulaması yok. Paket bugün gönderilirse PLUS ve VIP satın
alma akışı Windows'ta çalışmaz.

Üç seçenek var, ve bu bir ürün kararı:

1. **Windows'u ücretsiz katman olarak yayınla.** Listelemede abonelikten hiç
   bahsetme, satın almayı telefona bırak. Aynı hesap olduğu için telefonda
   alınan abonelik Windows'ta da geçerli — `subscriptions` tablosu kullanıcıya
   bağlı, cihaza değil. En hızlı yol, ve dürüst: mağaza metni satmadığı bir
   şeyi vaat etmiyor.
2. **Microsoft Store IAP ekle.** `PurchaseVerifier` arayüzünü uygulayan bir
   `microsoft_store` sürücüsü yazılır. Arayüz zaten sağlayıcıdan bağımsız
   tasarlanmış, yani mimari değişiklik gerekmiyor — sadece yeni bir sürücü.
3. **Kendi ödeme akışını kullan.** Microsoft, oyun olmayan uygulamaların kendi
   ödeme sistemlerini kullanmasına izin veriyor — bu, Apple ve Google'ın
   almadığı bir esneklik ve ekonomik olarak anlamlı. **Ancak** güncel koşulları
   gönderim öncesi Microsoft'un mağaza politikalarından doğrulayın; bu
   kural birkaç kez değişti ve burada yazdığım hâli garanti edemem.

`listing.md`'deki açıklama metni şu an **1. seçeneğe göre değil** — fiyatları
yazıyor. 1'i seçerseniz "ÜCRETLENDİRME" bölümünü metinden çıkarın, yoksa
listeleme uygulamanın Windows'ta yapamadığı bir şeyi vaat etmiş olur.

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
