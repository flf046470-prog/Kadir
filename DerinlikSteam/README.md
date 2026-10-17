# DERİNLİK — Steam "Coming Soon" hazırlığı

Bu klasör Steam mağaza sayfası için gereken her şeyi tek yerde toplar:

| Dosya / klasör | İçerik |
| --- | --- |
| `store-text.md` | EN + TR kısa açıklama, "Oyun hakkında" metni (Steam BBCode), etiketler, tür, dil, sistem gereksinimleri |
| `art/` | Mağaza ve kütüphane görselleri (Steam'in istediği ölçülerde) |
| `screenshots/` | 1920×1080 oyun içi ekran görüntüleri |
| `tools/` | Görselleri ve ekran görüntülerini yeniden üreten betikler |

Oyunun masaüstü (Steam) sürümü `../DerinlikDesktop/` içinde (Electron). Kurulum ve paketleme adımları oradaki README'de.

## Senin yapman gerekenler (sırayla)

Bunların hiçbirini ben yapamam ya da yapmamalıyım: hesap açmak, ödeme yapmak, kimlik/vergi bilgisi girmek ve sayfayı
yayınlamak senin kararın ve senin hesabınla olur. Tarihler ve kurallar Steamworks belgelerinden (17.10.2026'da kontrol edildi).

1. **Steamworks hesabı aç** — partner.steamgames.com → "Join Steamworks". Şirket ya da şahıs kimliği, banka bilgisi ve
   vergi formu istenir (Türkiye'den bireysel geliştirici için genelde W-8BEN; formu Steam kendi sihirbazında doldurtur).
2. **Steam Direct ücretini öde** — uygulama başına **100 USD**. İade edilmez; oyun Steam'de en az **1.000 USD** brüt
   gelir yaptıktan sonra ödemelerine geri eklenir.
3. **21 gün bekleme süresi** — ücreti ödediğin günden itibaren ilk oyununu en erken 21 gün sonra *çıkarabilirsin*.
   Coming Soon sayfası bu süre içinde açılabilir; bekleme yalnızca çıkış (release) için.
4. **"Create New App" → mağaza sayfasını doldur** — `store-text.md` içindeki metinleri, etiketleri ve gereksinimleri
   yapıştır; `art/` ve `screenshots/` içindeki görselleri yükle; içerik anketini (Content Survey) doldur.
5. **"Mark As Ready For Review"** — Valve sayfayı inceler. Sayfanın yayına girmesini istediğin tarihten **en az 7 iş
   günü önce** gönder.
6. **Onay gelince yeşil "Post as Coming Soon" düğmesine bas** — sayfa herkese açılır, istek listesi (wishlist) ve
   topluluk merkezi çalışmaya başlar.
7. **Çıkış için** — Coming Soon sayfası çıkıştan önce **en az 2 hafta** görünür kalmış olmalı; oyunun build'i de
   Steam'e yüklenip ayrıca incelemeden geçmeli.

## Coming Soon için hazır olanlar

- [x] Mağaza metinleri (EN + TR), etiketler, tür, sistem gereksinimleri taslağı → `store-text.md`
- [x] Oyunun çevrimdışı tek dosya sürümü (CDN yok, fontlar gömülü) → `DerinlikWeb/build.py --offline`
- [x] Masaüstü kabuğu (Electron) ve Windows paketi (`release/win-unpacked/Derinlik.exe`) → `DerinlikDesktop/`
- [ ] Mağaza ve kütüphane görselleri → `art/` (hazırlanıyor)
- [ ] En az 5 ekran görüntüsü, 1920×1080 → `screenshots/` (hazırlanıyor)
- [ ] Fragman (zorunlu değil, Steam "ideal olarak" istiyor)

## Karar vermen gerekenler

- **Dil:** Oyun şu an yalnızca Türkçe. Steam'de "desteklenen diller" kısmına bugün yalnızca Türkçe (arayüz + altyazı)
  işaretlenmeli. İngilizce çeviri satışlar için büyük fark yaratır; 1 yıllık geliştirme planının başına koymanı öneririm.
  Mağaza metni İngilizce de olabilir; bu, oyunun İngilizce olduğu anlamına gelmez ve öyle sunulmamalı.
- **Oyun süresi:** Şu anki içerik yaklaşık 25 dakika. Mağaza metinlerine süre yazmadım; çıkışta ne kadar olacağına sen
  karar verince eklenebilir.
- **Fiyat ve çıkış tarihi:** Coming Soon için gerekmez. Tarih alanında "Coming soon" ya da yalnızca yıl/çeyrek göstermek
  mümkün.
- **Sistem gereksinimleri:** `store-text.md` içindekiler tahmin; gerçek bir Windows PC'de (ideal olarak zayıf bir
  dizüstünde de) Yüksek/Orta/Düşük kalitede denenip düzeltilmeli. Bu ortamda yalnızca yazılım GPU'su (SwiftShader) var;
  gerçek kare hızını ölçemiyorum.
- **Steam Deck / Linux:** Linux paketi üretilebiliyor ama gerçek bir Linux ya da Deck'te denenmedi; denenene kadar
  yalnızca Windows'u işaretle.
