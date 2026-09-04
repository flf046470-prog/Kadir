# Play Console — girilecek her alan

Kopyalanıp yapıştırılmak üzere. Karakter sınırları Play'in dayattığı sınırlar;
her metnin altında sayacı yazılı.

---

## Uygulama adı  (30 karakter sınırı)

```
FioreMatch
```
10 / 30

## Kısa açıklama  (80 karakter sınırı)

```
Ortak diliniz olmasa da tanışın — mesajlar sohbetin içinde çevrilir
```
67 / 80

**Neden bu cümle:** Kısa açıklama, arama sonucunda başlığın altında görünen
tek satır. Rakiplerin hepsi ölçek satıyor — "milyonlarca kişi". Bu cümle
bunun yerine kimsenin çözmediği somut bir engeli söylüyor, ve nasıl
çözüldüğünü aynı satırda veriyor.

## Tam açıklama  (4000 karakter sınırı)

```
FioreMatch, ortak bir diliniz olmadan da tanışabileceğiniz bir uygulama.

DİL ENGELİ DİYE BİR ŞEY YOK
İkinizin de konuştuğu bir dil yoksa mesajlar sohbetin içinde otomatik çevrilir,
ve sana bunun neden olduğu söylenir. Orijinal metin her zaman çevirinin altında
durur — ne yazdığını göremediğin bir şey gönderilmez. Kapatmak bir dokunuş.
Arayüz 12 dilde.

Diğer uygulamalar seni pratikte kendi dilinin içine kapatıyor. Burada
Türkiye'deki biri Almanya'daki biriyle, ikisi de karşısındakinin dilini
bilmeden tanışabiliyor.

GÜNÜN 5'İ
Her gün senin için seçilmiş beş kişi. Akış değil, liste değil — beş karar.
Ertesi gün yenilenir. Saatlerce kaydırıp kimseyi hatırlamama hissi burada yok.

NEDEN EŞLEŞTİĞİNİZİ GÖRÜRSÜN
Her kartta eşleşmenin gerekçesi yazılı: ortak dil, aynı ilişki hedefi,
paylaşılan ilgi alanları, konum. Bir yüzdenin arkasına saklanan gizli bir
algoritma değil — ne gördüğünü ve neden gördüğünü okuyabilirsin.

DÜNYAYA AÇIK EŞLEŞME
Yakınındakiler, ülken, ya da sınır tanımayan mod. Taşınmayı planlıyorsan
gelecekteki şehrini de yazabilirsin.

GÜVENLİK PAZARLAMA CÜMLESİ DEĞİL
- Her mesaj dolandırıcılık açısından değerlendirilir ve şüpheli olan sana
  uyarıyla gösterilir.
- Fotoğraflar diğer üyeler görmeden önce incelenir.
- Yüklediğin her fotoğraftan konum bilgisi silinir.
- Engelleme ve bildirme her ekranda, ve hiçbir zaman ücretli değil.
- Hesabını uygulamanın içinden silebilirsin; profilin, fotoğrafların,
  eşleşmelerin ve mesajların birlikte gider.

EŞLEŞME OYUNLARI
İlk sohbeti kolaylaştıran beş kısa oyun. İkiniz de cevaplayana kadar hiçbiriniz
diğerinin cevabını göremez — bu, uygulamaya güvenerek değil sunucu zorunlu
kılarak sağlanıyor. Oynamamak da gayet normal bir cevap.

ÜCRETSİZ NE VAR
Profil, Keşfet, eşleşme, mesajlaşma, standart filtreler, engelleme ve bildirme.
Günde 50 beğeni, 3 hediye. Tanışmak için ödeme gerekmiyor.

PLUS — yılda 19,99 $
Gelişmiş filtreler, günde 200 beğeni, seni kimlerin beğendiğini görmek,
son geçişini geri almak, sohbet içi çeviri, günde 10 hediye.

VIP — yılda 49,99 $
PLUS'taki her şey, artı sınırsız beğeni ve hediye, profil ziyaretçilerin,
Keşfet'te öncelikli görünürlük, kartında VIP rozeti ve her ay 60 dakikalık
Boost.

Aylık, istediğin zaman iptal edilir. Reklam yok, jeton yok, her tıkta satın
alma yok.
```
2277 / 4000

**Not:** Fiyat satırları `src/lib/billing/tiers.ts` içindeki `MONTHLY_PRICE_CENTS`
ile aynı olmalı. Orada değişirse burada da değişmeli — Play'de yanlış fiyat
yazmak politika ihlali.

---

## Kategori ve etiketler

| Alan | Değer |
|---|---|
| Uygulama kategorisi | Dating |
| Etiketler | Dating, Social, Lifestyle |
| E-posta | support@fiorematch.com |
| Web sitesi | https://fiorematch.com |
| Gizlilik politikası | https://fiorematch.com/tr/legal/privacy |

Gizlilik politikası URL'i **zorunlu** ve dağıtım ayakta olmadan girilemez.

**Pazarlama sitesi yayınlanmıyor** (`PUBLIC_SITE=off`). Bu iki adresin ikisi de
yine de cevap veriyor ve vermek zorunda: kök, mağazalara işaret eden bir sayfa
gösteriyor, gizlilik politikası ve kullanım koşulları ise uygulama kurulu
olmayan bir tarayıcıya açılıyor. Play, politika URL'i cevap vermezse listeyi
reddediyor.

---

## Veri Güvenliği formu

Play bu formu politika beyanı sayar; yanlış cevap ihlaldir. Cevaplar kodda
doğrulandı, tahmin değil.

### Genel

| Soru | Cevap | Dayanağı |
|---|---|---|
| Veriler aktarımda şifreleniyor mu | **Evet** | Kabukta `cleartext: false`, `androidScheme: https` |
| Kullanıcılar silme talep edebilir mi | **Evet** | Profil → Hesabınızı silin, uygulama içinde |
| Veriler üçüncü taraflarla paylaşılıyor mu | **Evet, kısmen** | Yalnızca çeviri açıksa: mesaj metni çeviri sağlayıcısına gider |

### Toplanan veri türleri

Hepsi hesapla ilişkili, hiçbiri takip veya reklam için kullanılmıyor.

| Tür | Toplanıyor | Paylaşılıyor | Zorunlu | Amaç |
|---|---|---|---|---|
| İsim | Evet | Hayır | Evet | Uygulama işlevselliği |
| E-posta | Evet | Hayır | Evet | Uygulama işlevselliği, hesap yönetimi |
| Kullanıcı kimliği | Evet | Hayır | Evet | Uygulama işlevselliği |
| Fotoğraf | Evet | Hayır | Hayır | Uygulama işlevselliği |
| Mesajlar | Evet | Evet\* | Hayır | Uygulama işlevselliği |
| Yaklaşık konum | Evet | Hayır | Evet | Uygulama işlevselliği |
| Cihaz kimliği | Evet | Hayır | Hayır | Uygulama işlevselliği (bildirim) |

\* Yalnızca üye çeviriyi kullandığında ve yalnızca yapılandırılmış sağlayıcıya.
Varsayılan olarak kapalı; sağlayıcı tanımlı değilse özellik hiç görünmüyor.

**Konum sorusu dikkat:** "Yaklaşık konum" işaretlenmeli, "Kesin konum"
işaretlenMEmeli. Uygulama cihaz konumunu hiç okumuyor — üye şehir ve ülkeyi
listeden seçiyor, koordinat hiç saklanmıyor.

---

## İçerik derecelendirme anketi

| Soru | Cevap |
|---|---|
| Uygulama türü | Dating |
| Kullanıcılar birbirleriyle iletişim kurabiliyor mu | Evet |
| Kullanıcı içeriği moderasyondan geçiyor mu | **Evet** |
| Kullanıcılar konum paylaşıyor mu | Yaklaşık (şehir), diğer kullanıcılarla |
| Kullanıcılar kişisel bilgi paylaşabiliyor mu | Evet (profil) |
| Şiddet, korku, cinsellik içeriği | Hayır |

Beklenen sonuç: **Mature 17+** / PEGI 18.

"Moderasyondan geçiyor mu" sorusuna **evet** demek önemli ve doğru: fotoğraflar
onaya tabi, mesajlar Scam Shield'den geçiyor, bildirme ve engelleme her ekranda.
Hayır demek dereceyi yükseltir ve yanlış olur.

---

## Görseller

`mobile/play-store/assets/` içinde:

| Dosya | Boyut | Play'in istediği |
|---|---|---|
| `feature-graphic-1024x500.png` | 1024×500 | 1024×500, zorunlu |
| `01-kesfet.png` | 1080×1920 | Telefon, en az 2 tane |
| `02-gunun-5i.png` | 1080×1920 | " |
| `03-otomatik-ceviri.png` | 1080×1920 | " |
| `04-seni-begenenler.png` | 1080×1920 | " |
| `05-fiyatlandirma.png` | 1080×1920 | " |

Uygulama ikonu için `public/icons/icon-512.png` (512×512).

**Ekran görüntüleri hakkında iki uyarı:**

1. İçerikteki profiller test hesapları, fotoğraflar sentetik degrade — gerçek
   bir kişinin görseli kullanılmadı. Uygulama gerçek üyelerle dolduğunda
   yeniden çekmek daha iyi olur.
2. `03-otomatik-ceviri.png` bir çeviri sağlayıcısı taklidiyle üretildi.
   Mekanizma gerçek (ortak dil yoksa çeviri kendiliğinden açılıyor, orijinal
   altta duruyor) ama Türkçe metinler stub'dan geldi. `DEEPL_API_KEY` tanımlı
   bir ortamda yeniden çekilmesi doğru olur.

---

## Yüklemeden önce

Bunlar tamamlanmadan gönderme; ilk ikisi kesin ret sebebi.

- [ ] **Dağıtım ayakta olmalı.** Uygulama `https://fiorematch.com` adresini
      yüklüyor. Adres cevap vermezse inceleme uzmanı çevrimdışı ekranını görür
      ve uygulama reddedilir. Pazarlama sitesi yayınlanmasa da sunucunun
      çalışıyor olması gerekiyor — kalkan şey site, arkadaki API değil.
- [ ] **Gizlilik politikası URL'i erişilebilir olmalı.** `PUBLIC_SITE=off`
      iken bile açık; kapatılmadığını doğrula.
- [ ] Play App Signing etkinleştirilmeli.
- [ ] `ANDROID_CERT_FINGERPRINTS` hem upload hem Google app signing anahtarının
      parmak izini içermeli (virgülle).
- [ ] Abonelik satılacaksa **Play Billing** entegre edilmeli. Şu an satın alma
      yolu hiç yok; fiyatlandırma sayfası satın alınamayan bir şeyin reklamını
      yapıyor.
- [ ] Bildirim gönderimi için Firebase projesi ve `google-services.json`.
