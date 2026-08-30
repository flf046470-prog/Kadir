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
Günde beş kişi, gerekçeli
```
25 / 30

Altyazı App Store'da adın hemen altında görünür ve aramada ağırlığı var.
"Gerekçeli" kelimesi burada duruyor çünkü ürünü tek kelimede ayıran şey o.

---

## Anahtar kelimeler  (100 karakter, virgülle, boşluksuz)

```
tanışma,arkadaşlık,ilişki,yurtdışı,çeviri,sohbet,eşleşme,uluslararası,güvenli,dating
```
82 / 100

Uygulama adında geçen kelimeleri tekrar etme — Apple onları zaten indeksliyor,
tekrar etmek alanı israf eder.

---

## Tanıtım metni  (170 karakter, sürüm çıkmadan güncellenebilir)

```
Ortak diliniz yoksa mesajlar kendiliğinden çevrilir, orijinali altta durur. Günün 5'i her sabah yenilenir. Neden eşleştiğinizi her kartta okursunuz.
```
147 / 170

---

## Açıklama  (4000 karakter)

```
FioreMatch, sonsuz kaydırma üzerine kurulmamış bir tanışma uygulaması.

GÜNÜN 5'İ
Her gün senin için seçilmiş beş kişi. Akış değil, liste değil — beş karar.
Ertesi gün yenilenir.

NEDEN EŞLEŞTİĞİNİZİ GÖRÜRSÜN
Her kartta eşleşmenin gerekçesi yazılı: ortak dil, aynı ilişki hedefi,
paylaşılan ilgi alanları, konum. Gizli bir puanın arkasına saklanmıyor.

ORTAK DİLİNİZ YOKSA ÇEVİRİ KENDİLİĞİNDEN AÇILIR
İkinizin de konuştuğu bir dil yoksa mesajlar otomatik çevrilir ve sana bunun
neden olduğu söylenir. Orijinal metin her zaman altta durur. Kapatmak bir
dokunuş.

DÜNYAYA AÇIK EŞLEŞME
Yakınındakiler, ülken, ya da sınır tanımayan mod. 12 dilde arayüz.

GÜVENLİK PAZARLAMA CÜMLESİ DEĞİL
Her mesaj dolandırıcılık açısından değerlendirilir. Fotoğraflar diğer üyeler
görmeden önce incelenir ve her yüklemeden konum bilgisi silinir. Engelleme ve
bildirme her ekranda ve hiçbir zaman ücretli değil. Hesabını uygulamanın
içinden silebilirsin — profilin, fotoğrafların, eşleşmelerin ve mesajların
birlikte gider.

EŞLEŞME OYUNLARI
İlk sohbeti kolaylaştıran beş kısa oyun. İkiniz de cevaplayana kadar hiçbiriniz
diğerinin cevabını göremez.

ÜCRETSİZ NE VAR
Profil, Keşfet, eşleşme, mesajlaşma, standart filtreler, engelleme ve bildirme.
Günde 50 beğeni, 3 hediye.

PLUS — yılda 1,99 $
Gelişmiş filtreler, günde 200 beğeni, seni kimlerin beğendiği, son geçişi geri
alma, sohbet içi çeviri, günde 10 hediye.

VIP — yılda 5,99 $
PLUS'taki her şey, artı sınırsız beğeni ve hediye, profil ziyaretçilerin,
öncelikli görünürlük, VIP rozeti ve her ay 60 dakikalık Boost.

Abonelikler yıllıktır ve otomatik yenilenir. Yenilemeyi dönem bitiminden en az
24 saat önce kapatmazsan aynı ücretle uzatılır. Aboneliğini Ayarlar > Apple
Kimliği > Abonelikler bölümünden yönetebilir veya iptal edebilirsin.

Gizlilik politikası: https://fiorematch.com/tr/legal/privacy
Kullanım koşulları: https://fiorematch.com/tr/legal/terms
```
1512 / 4000

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

**Takip hiçbir türde yok.** Bu, `mobile/store/PrivacyInfo.xcprivacy` içindeki
`NSPrivacyTracking = false` ile aynı beyan; ikisi çelişirse Apple fark eder.

**Kaba konum** — kesin konum değil. Uygulama cihaz konumunu hiç okumuyor.

---

## İnceleme uzmanı için not (App Review Notes)

```
Deneme hesabı: (yayına almadan önce doldurulacak)
Parola: (aynı)

Uygulama, oturum ve veri sunucu tarafında olduğu için yayındaki siteyi yükleyen
bir kabuktur. Native olan kısımlar: bildirimler, Universal Links, durum çubuğu,
klavye davranışı.

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

App Store, Play'den farklı boyutlar istiyor. `mobile/store/assets/` içindeki
1080×1920'lik ekran görüntüleri **Play için**; Apple bunları kabul etmez.

| Gerekli | Boyut | Durum |
|---|---|---|
| 6,9" iPhone ekran görüntüsü | 1290×2796 | **yok** |
| 6,5" iPhone ekran görüntüsü | 1242×2688 | **yok** |
| Uygulama ikonu | 1024×1024 | var — `mobile/assets/AppIcon-1024.png` |

iPhone ekran görüntüleri bir Mac'te simülatörden alınmalı; bu boyutlar
tarayıcıdan üretilebilir ama Apple gerçek cihaz oranlarını bekliyor ve
simülatör çıktısı daha güvenli.

---

## Yüklemeden önce

- [ ] **iOS projesi oluşturulmalı** (`npx cap add ios`, macOS gerekiyor)
- [ ] `mobile/store/PrivacyInfo.xcprivacy` Xcode hedefine eklenmeli
- [ ] Associated Domains: `applinks:fiorematch.com`
- [ ] Push Notifications yetkisi + APNs anahtarı
- [ ] **Site yayında olmalı** — yoksa inceleme uzmanı çevrimdışı ekranı görür
- [ ] StoreKit ile abonelik ürünleri tanımlanmalı (1,99 $ ve 5,99 $ yıllık)
- [ ] 6,9" ve 6,5" ekran görüntüleri simülatörden alınmalı
