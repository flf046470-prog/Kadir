# App Store Connect — girilecek her alan

Play listesiyle aynı ürünü anlatıyor ama Apple'ın alanları ve sınırları farklı,
ve iki mağazanın reddettiği şeyler de farklı. Bu dosya Apple tarafını kapsıyor.

**Önce bilinmesi gereken:** Bu metinler girilebilir hâle gelmeden önce bir iOS
projesi gerekiyor ve o proje henüz yok. `npx cap add ios` macOS ve Xcode
istiyor. Adımları `mobile/ios/README.md` içinde.

---

## Ad ve altyazı

### Uygulama adı  (30 karakter)

```
FioreMatch
```
10 / 30

### Altyazı  (30 karakter)

```
Dil engeli olmadan tanışın
```
26 / 30

Altyazı App Store'da adın hemen altında görünür ve aramada ağırlığı var.
Ürünü rakiplerinden ayıran tek şeyi söylüyor. "Günde beş kişi" iyi bir
cümleydi ama Hinge de benzerini söylüyor; dil engeli kimsenin söylemediği şey.

---

## Anahtar kelimeler  (100 karakter, virgülle, boşluksuz)

```
tanışma,arkadaşlık,ilişki,çeviri,yurtdışı,expat,gurbetçi,uluslararası,sohbet,dating
```
83 / 100

Uygulama adında geçen kelimeleri tekrar etme — Apple onları zaten indeksliyor,
tekrar etmek alanı israf eder.

---

## Tanıtım metni  (170 karakter, sürüm çıkmadan güncellenebilir)

```
Ortak diliniz olmasa da tanışın: mesajlar sohbetin içinde çevrilir, orijinali altta durur. Günün 5'i her sabah yenilenir, ve neden eşleştiğinizi okursunuz.
```
155 / 170

---

## Açıklama  (4000 karakter)

```
FioreMatch, ortak bir diliniz olmadan da tanışabileceğiniz bir uygulama.

DİL ENGELİ DİYE BİR ŞEY YOK
İkinizin de konuştuğu bir dil yoksa mesajlar sohbetin içinde otomatik çevrilir
ve sana bunun neden olduğu söylenir. Orijinal metin her zaman çevirinin altında
durur — ne yazdığını göremediğin bir şey gönderilmez. Kapatmak bir dokunuş.
Arayüz 12 dilde.

Diğer uygulamalar seni pratikte kendi dilinin içine kapatıyor. Burada
Türkiye'deki biri Almanya'daki biriyle, ikisi de karşısındakinin dilini
bilmeden tanışabiliyor.

GÜNÜN 5'İ
Her gün senin için seçilmiş beş kişi. Akış değil, liste değil — beş karar.
Ertesi gün yenilenir.

NEDEN EŞLEŞTİĞİNİZİ GÖRÜRSÜN
Her kartta eşleşmenin gerekçesi yazılı: ortak dil, aynı ilişki hedefi,
paylaşılan ilgi alanları, konum. Gizli bir puanın arkasına saklanmıyor.

DÜNYAYA AÇIK EŞLEŞME
Yakınındakiler, ülken, ya da sınır tanımayan mod. Taşınmayı planlıyorsan
gelecekteki şehrini de yazabilirsin.

GÜVENLİK PAZARLAMA CÜMLESİ DEĞİL
- Her mesaj dolandırıcılık açısından değerlendirilir; şüpheli olan sana
  uyarıyla gösterilir.
- Fotoğraflar diğer üyeler görmeden önce incelenir.
- Yüklediğin her fotoğraftan konum bilgisi silinir.
- Engelleme ve bildirme her ekranda, ve hiçbir zaman ücretli değil.
- Hesabını uygulamanın içinden silebilirsin; profilin, fotoğrafların,
  eşleşmelerin ve mesajların birlikte gider.

EŞLEŞME OYUNLARI
İlk sohbeti kolaylaştıran beş kısa oyun. İkiniz de cevaplayana kadar hiçbiriniz
diğerinin cevabını göremez.

ÜCRETSİZ NE VAR
Profil, Keşfet, eşleşme, mesajlaşma, standart filtreler, engelleme ve bildirme.
Günde 50 beğeni, 3 hediye.

PLUS — yılda 19,99 $
Gelişmiş filtreler, günde 200 beğeni, seni kimlerin beğendiğini görmek,
son geçişini geri almak, sohbet içi çeviri, günde 10 hediye.

VIP — yılda 49,99 $
PLUS'taki her şey, artı sınırsız beğeni ve hediye, profil ziyaretçilerin,
Keşfet'te öncelikli görünürlük, kartında VIP rozeti ve her ay 60 dakikalık
Boost.

Aylık abonelik, istediğin zaman iptal edilir. Reklam yok, jeton yok.
```
2001 / 4000

**Son paragraf zorunlu.** Apple, otomatik yenilenen abonelik satan
uygulamalarda süre, ücret, yenileme ve iptal bilgisinin açıklamada bulunmasını
istiyor; eksikse 3.1.2'den reddediliyor.

---

## Yaş sınırı

| Soru | Cevap |
|---|---|
| Sınırsız web erişimi | Hayır |
| Kullanıcı üretimi içerik | **Evet — moderasyonlu** |
| Cinsel içerik veya çıplaklık | Hayır |
| Şiddet | Hayır |
| Kumar | Hayır |

Sonuç: **17+**. Buluşma uygulamaları zaten 17+ altına inemiyor.

---

## Destek iletişimi

App Store Connect'te **Support URL** zorunlu alan.

| Alan | Değer |
|---|---|
| Support URL | https://fiorematch.com/tr/contact |
| Destek e-postası | support@fiorematch.com |

Adres kodda tek yerde tutuluyor (`src/lib/site.ts` → `supportEmail`), iletişim
sayfası oradan okuyor, ve `npm run store:check` üç listenin de aynı adresi
yazdığını doğruluyor. Yüklemeden önce bu kutuya bir test e-postası atıp yanıt
alabildiğinizi teyit edin: çalışmayan bir destek adresi inceleme reddi sebebi.

---

## Uygulama gizliliği (App Privacy) — Apple'ın "nutrition label" formu

Toplanan tür / hesapla ilişkili mi / takip için mi:

| Tür | Toplanıyor | Kimliğe bağlı | Takip için |
|---|---|---|---|
| İsim | Evet | Evet | Hayır |
| E-posta | Evet | Evet | Hayır |
| Kullanıcı kimliği | Evet | Evet | Hayır |
| Fotoğraf | Evet | Evet | Hayır |
| Mesajlar | Evet | Evet | Hayır |
| Kaba konum | Evet | Evet | Hayır |
| Cihaz kimliği | Evet | Evet | Hayır |

**Takip hiçbir türde yok.** Bu, `mobile/ios/App/App/PrivacyInfo.xcprivacy` içindeki
`NSPrivacyTracking = false` ile aynı beyan; ikisi çelişirse Apple fark eder.

**Kaba konum** — kesin konum değil. Uygulama cihaz konumunu hiç okumuyor.

---

## İnceleme uzmanı için not (App Review Notes)

```
Deneme hesabı: (yayına almadan önce doldurulacak)
Parola: (aynı)

Uygulama, oturum ve veri sunucu tarafında olduğu için kendi sunucusunu yükleyen
bir kabuktur. Native olan kısımlar: bildirimler, Universal Links, durum çubuğu,
klavye davranışı. Ürünün herkese açık bir pazarlama sitesi yok; alan adı yalnızca
uygulamaya, gizlilik politikasına ve kullanım koşullarına cevap veriyor.

Hesap silme: Profilin > Hesabınızı silin. Onay için "sil" yazılması gerekiyor.
İşlem profili, fotoğrafları, eşleşmeleri ve mesajları kaldırır.

Otomatik çeviri: iki üyenin ortak dili yoksa çeviri kendiliğinden açılır ve
sebebi ekranda yazılıdır. Manuel olarak kapatılabilir.
```

---

## Apple'ın bu uygulamada bakacağı üç madde

**4.2 Minimum İşlevsellik.** Kabuk bir web sitesi yüklüyor ve Apple yalnızca
sarmalayıcı olan uygulamaları reddediyor. Ayıran şeyler: bildirimler, Universal
Links, ve gerçekten bir uygulama olan bir ürün. İnceleme itiraz ederse cevap
daha fazla native yüzey eklemek, tartışmak değil.

**5.1.1(v) Hesap Silme.** Karşılanıyor ve uygulama içinde. Destek e-postası
kabul edilmiyor.

**3.1.1 Uygulama İçi Satın Alma.** Dijital abonelik App Store içi satın almadan
geçmek zorunda. Stripe veya web checkout ile satılırsa reddedilir. **Şu an
satın alma yolu hiç yok** — StoreKit entegre edilmeden abonelik satılamaz.

---

## Görseller

App Store, Play'den farklı boyutlar istiyor — 1080×1920 kabul edilmiyor, ve
ölçeklenerek de kabul ettirilemiyor: 9:19,5 çerçeve 9:16'dan daha uzun, birini
diğerinin içine sığdırmak ya üstte altta bant bırakıyor ya da uygulamanın
kenarlarını kesiyor.

Bu yüzden her yakalama, Apple'ın istediği tuvalin üstüne, ürünün kendi aurora
zemininde bir cihaz çerçevesi içine **yerleştiriliyor**. `npm run store:appstore`
ikisini de üretiyor.

| Gerekli | Boyut | Durum |
|---|---|---|
| 6,9" iPhone ekran görüntüsü | 1290×2796 | var — `assets/6.9-inch/` |
| 6,5" iPhone ekran görüntüsü | 1242×2688 | var — `assets/6.5-inch/` |
| Uygulama ikonu | 1024×1024 | var — `mobile/assets/AppIcon-1024.png`, alfa kanalsız |

**Bunlar vekil.** Çerçevenin içindeki pikseller gerçek, ama tarayıcıda Play
boyutlarında ve tohumlanmış bir veritabanına karşı alındılar. İki tanesinin
içeriği yayına uygun değil: fiyatlandırma ekranı "$0"ın ortasında kesiliyor ve
Günün 5'i ekranında "Nur profili." tohum metni görünüyor. Sunucu ayağa
kalktığında simülatörden yeniden çekilmeli — o zaman bu betiğe hiç gerek
kalmaz, çünkü simülatör zaten doğru boyutta çıktı verir.

---

## Yüklemeden önce

- [ ] **iOS projesi oluşturulmalı** (`npx cap add ios`, macOS gerekiyor)
- [ ] `mobile/ios/App/App/PrivacyInfo.xcprivacy` Xcode hedefine eklenmeli
- [ ] Associated Domains: `applinks:fiorematch.com`
- [ ] Push Notifications yetkisi + APNs anahtarı
- [ ] **Dağıtım ayakta olmalı** — yoksa inceleme uzmanı çevrimdışı ekranı görür.
      Pazarlama sitesi yayınlanmıyor, ama sunucunun çalışması şart.
- [ ] StoreKit ile abonelik ürünleri tanımlanmalı (19,99 $ ve 49,99 $ yıllık)
- [ ] 6,9" ve 6,5" ekran görüntüleri simülatörden alınmalı
