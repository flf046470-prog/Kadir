# Partner Center — girilecek her alan

Kopyalanıp yapıştırılmak üzere. Karakter sınırları Microsoft'un dayattığı
sınırlar; her metnin altında sayacı yazılı.

Play ve App Store metinlerinden ayrı bir dosya olmasının sebebi, Microsoft'un
farklı alanlar istemesi: burada "kısa açıklama" 80 değil 1.000 karakter, ayrıca
Play'de hiç bulunmayan "ürün özellikleri" ve "arama terimleri" alanları var.
Aynı metni üç yere kopyalamak, birini güncelleyip diğerini unutmanın en kısa
yolu — bu yüzden her mağazanın kendi dosyası var.

> **Not:** Aşağıdaki sınırların hepsi Partner Center'da alanın altında canlı
> sayaç olarak da görünür. Bir alanın sayacı buradakiyle uyuşmuyorsa **sayaca
> güven** — Microsoft bunları haber vermeden değiştirebiliyor.

---

## Ürün adı  (ayrılmış ad)

```
FioreMatch
```

Partner Center'da ad, listeleme metninden önce **ayrılır** (*Product identity →
Reserve a name*). Ayrılmamış bir adla listeleme kaydedilemez. Ad ayrıldıktan
sonra paketin kimliği de buradan gelir — `submission.md`'deki kimlik tablosuna
bakın.

## Kısa açıklama  (1.000 karakter sınırı)

```
Ortak bir diliniz olmadan da tanışın. Mesajlar sohbetin içinde otomatik
çevrilir, orijinali her zaman çevirinin altında durur ve size neden
çevrildiği söylenir. Her gün için seçilmiş beş kişi — sonsuz kaydırma yok.
Her kartta neden eşleştiğinizin gerekçesi yazılı: ortak dil, aynı ilişki
hedefi, paylaşılan ilgi alanları, konum. Gizli bir algoritma değil,
okuyabildiğiniz bir liste.
```
382 / 1.000

**Neden bu metin:** Microsoft'un kısa açıklaması Play'inki gibi tek satır değil,
arama sonucunda ve ürün sayfasının üstünde görünen tam bir paragraf. Yine de ilk
cümle belirleyici — mağaza kartında çoğu zaman sadece o görünüyor. O yüzden
birinci cümle ürünün tek farkını söylüyor, gerisi onu açıyor.

## Açıklama  (10.000 karakter sınırı)

```
FioreMatch, ortak bir diliniz olmadan da tanışabileceğiniz bir uygulama.

DİL ENGELİ DİYE BİR ŞEY YOK
İkinizin de konuştuğu bir dil yoksa mesajlar sohbetin içinde otomatik çevrilir,
ve size bunun neden olduğu söylenir. Orijinal metin her zaman çevirinin altında
durur — ne yazdığınızı göremediğiniz bir şey gönderilmez. Kapatmak bir dokunuş.
Arayüz 12 dilde.

Ücretsiz hesapta günde 15 mesaj çevirisi var; bu, karşınızdakini tanımaya
yetecek gerçek bir sohbet demek. PLUS ve VIP'te sınır kalkıyor. Satılan şey
özelliğin kendisi değil, tavanı.

Diğer uygulamalar sizi pratikte kendi dilinizin içine kapatıyor. Burada
Türkiye'deki biri Almanya'daki biriyle, ikisi de karşısındakinin dilini
bilmeden tanışabiliyor.

GÜNÜN 5'İ
Her gün sizin için seçilmiş beş kişi. Akış değil, liste değil — beş karar.
Ertesi gün yenilenir. Saatlerce kaydırıp kimseyi hatırlamama hissi burada yok.

NEDEN EŞLEŞTİĞİNİZİ GÖRÜRSÜNÜZ
Her kartta eşleşmenin gerekçesi yazılı: ortak dil, aynı ilişki hedefi,
paylaşılan ilgi alanları, konum. Bir yüzdenin arkasına saklanan gizli bir
algoritma değil — ne gördüğünüzü ve neden gördüğünüzü okuyabilirsiniz.

GÜVENLİK
Engelleme ve bildirme her ekranda. Konum şehir düzeyinde tutulur, koordinat
olarak değil. Hesabınızı silerseniz verileriniz de gider — arşivlenmez.

WINDOWS'TA
Uygulama pencerede çalışır, yeniden boyutlandırılabilir ve Başlat menüsüne
sabitlenebilir. Aynı hesap telefonda ve bilgisayarda aynı sohbetleri gösterir.

ÜCRETLENDİRME
Ücretsiz başlayın. PLUS yılda 19,99 USD, VIP yılda 49,99 USD; fiyatlar mağazanın
desteklediği yerlerde kendi para biriminizde görünür. İstediğiniz an iptal
edin, ödediğiniz dönem bitene kadar erişiminiz sürer.
```
1.287 / 10.000

**Neden bu sıra:** Dil engeli en başta, çünkü rakiplerde olmayan tek şey o.
Ücretsiz kotanın açıkça yazılması bilinçli — mağaza açıklaması çeviriyi
vaat edip uygulama onu ücretli duvarın arkasına koysaydı, bu yanlış mağaza
açıklaması olurdu, cimri bir ücretsiz katman değil.

"Windows'ta" bölümü sadece bu mağazada var: Play ve App Store'da anlamsız,
burada ise incelemeyi yapan kişinin ilk sorduğu şey ("bu gerçekten masaüstünde
çalışıyor mu, yoksa telefon uygulamasının kılıfı mı").

## Sürümde yenilikler  (1.500 karakter sınırı)

İlk gönderim için:

```
İlk Windows sürümü.
```
19 / 1.500

Sonraki güncellemelerde burayı boş bırakmayın — Microsoft boş bırakılmasına
izin veriyor, ama mağaza sayfasında "bu sürümde yenilikler" başlığı altında
boşluk görünüyor.

## Ürün özellikleri  (en fazla 20 madde, her biri 200 karakter)

```
Ortak diliniz olmasa da sohbet: mesajlar otomatik çevrilir, orijinali altta durur
Ücretsiz hesapta günde 15 çeviri, PLUS ve VIP'te sınırsız
Günün 5'i: her gün seçilmiş beş kişi, sonsuz kaydırma yok
Her eşleşmenin gerekçesi kartta yazılı — gizli puanlama yok
Arayüz 12 dilde
Konum şehir düzeyinde tutulur, koordinat olarak değil
Engelleme ve bildirme her ekranda
Hesap silindiğinde veriler de silinir
```
8 madde

Bunlar ürün sayfasında madde imli liste olarak görünüyor; cümle değil, ifade
olarak yazılmaları gerekiyor. En uzunu 81 karakter, sınırın çok altında.

## Arama terimleri  (en fazla 7 terim, her biri 30 karakter)

```
çeviri
dil değişimi
yurt dışı tanışma
translation dating
language exchange
ciddi ilişki
serious dating
```
7 / 7

Arama terimleri **ürün sayfasında görünmez**, sadece aramada eşleşir. O yüzden
açıklamada zaten geçen kelimeleri buraya tekrar yazmak yer israfı — Microsoft
açıklamayı da indeksliyor. Buradakiler açıklamada birebir geçmeyen ya da
İngilizce arayan birinin yazacağı karşılıklar.

## Telif hakkı ve ticari marka bilgisi  (200 karakter)

```
© 2026 FioreMatch
```
17 / 200

## Geçerli lisans koşulları

Kullanım koşullarının tam metni ya da URL'si. Uygulamanın kendi sayfası
kullanılmalı:

```
https://fiorematch.com/tr/terms
```

## Gizlilik politikası URL'si  (zorunlu)

```
https://fiorematch.com/tr/privacy
```

Bu alan bu uygulama için **zorunlu**: kişisel veri işleyen her ürün için
Microsoft gizlilik politikası istiyor, ve URL'nin gönderim anında yayında
olması gerekiyor — inceleme sırasında açılmayan bir bağlantı reddedilme
sebebi. Yer tutucu bir sayfa koymayın, gerçek metin olsun.

## Destek iletişimi

```
support@fiorematch.com
```

Üç mağaza da çalışan bir destek adresi şart koşuyor, ve bu adres kodda tek bir
yerde tutuluyor — `src/lib/site.ts` → `supportEmail` — iletişim sayfası da
oradan okuyor. Buradaki metin onunla aynı kalmalı: listede yazan ama kimsenin
okumadığı bir kutu, geç yanıttan daha kötüdür. Teslimden önce bu adrese bir
test e-postası atıp yanıt alabildiğinizi doğrulayın.

---

## Yaş sınıflandırması

Microsoft, IARC anketini kullanıyor — Play'dekiyle aynı sistem, ama **ayrı
doldurulması gerekiyor**; Play'deki sertifika buraya taşınmıyor.

Dürüst cevaplanması gereken sorular:

- **Kullanıcılar birbiriyle iletişim kurabiliyor mu?** Evet — serbest metin
  mesajlaşma.
- **Kullanıcı tarafından oluşturulan içerik paylaşılıyor mu?** Evet — profil
  metni ve mesajlar.
- **Konum paylaşılıyor mu?** Şehir düzeyinde, diğer kullanıcılara görünür.
- **Dijital satın alma var mı?** Evet — abonelik.
- **Romantik/flört içeriği?** Evet, uygulamanın tamamı bu.

Bu cevaplarla çıkan sınıflandırma büyük olasılıkla **16+ veya 18+** olacak.
Anketi "daha düşük bir yaş çıksın diye" yumuşatmak, sonradan yeniden
sınıflandırma ve listelemenin kaldırılmasıyla sonuçlanıyor — IARC beyanı
denetliyor.

## Kategori

```
Sosyal
```

Microsoft'un kategori listesinde "Dating" ayrı bir alt kategori olarak yok;
*Social* doğru üst kategori. Alt kategori olarak *Social networking* seçilir.

## Desteklenen dil beyanı

Uygulama arayüzü 12 dilde. Partner Center'da her dil için ayrı listeleme
metni girilebilir; **girilmeyen diller için** mağaza varsayılan listelemeyi
gösteriyor. Bu dosya Türkçe listelemedir.

İlk gönderimde en az Türkçe ve İngilizce listelemenin girilmesi mantıklı:
diğer on dil için arayüz çevrilmiş olsa da mağaza metni çevrilmemiş durumda,
ve makine çevirisi bir mağaza sayfasında iyi durmuyor.
