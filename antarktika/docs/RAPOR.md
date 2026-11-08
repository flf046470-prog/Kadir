# Performans ve test raporu

> **Önemli:** Aşağıdaki ölçümler başsız Chromium + SwiftShader (yazılımsal WebGL) üzerinde alındı. **Bunlar iPhone ölçümü değildir.** iPhone FPS'i yalnızca gerçek cihazda Safari Web Inspector veya `?perf=1` paneliyle ölçülmelidir (bkz. `TESTFLIGHT_KONTROL_LISTESI.md`). 30–60 FPS hedefine ulaşıldığı **iddia edilmiyor**.

## Otomatik oynanış testi (`tools/play_test.cjs`) — 18/18 geçti, konsol hatası 0
| Kontrol | Sonuç |
|---|---|
| GLB'ler yüklenir (istasyon, mağara, karakter, eller) | ✔ 2,25 sn (SwiftShader) |
| Duvar çarpışması, rampa yüksekliği, korkuluk, sürgülü kapı | ✔ |
| Telsiz enerjisiz reddeder → jeneratör → telsiz prologue adım 2 | ✔ |
| Frekans bulmacası: 3.17 MHz kilitlenir → görev 04 | ✔ |
| Kristal sırası: yanlışta sıfırlanır, mavi→altın→mor A1 çekirdeğini açar | ✔ |
| Dr. Selin devriye yürür, konuşunca Interact animasyonu | ✔ |
| Kayıt → yeniden yükle → DEVAM ET: konum, görev, bulmacalar, kalıntılar, günlük geri gelir | ✔ |
| 3 kalite seviyesi çözünürlüğü değiştirir (819×460 / 1024×576) | ✔ |

## Diğer otomatik testler (son koşu)
| Test | Sonuç | Kapsam |
|---|---|---|
| `tools/touch_test.cjs` | 8/8 ✔ | Telefon boyutu (852×393) dokunmatik: yüzen analog çubuk, yarım/tam itiş hızı, sağ yarıda bakış, hata yok |
| `tools/xr_test.cjs` | 4/4 ✔ | Sahte WebXR oturumu: kare başına 2 göz görüntüsü, sol çubukla yürüme, kumanda elleri, hata yok |
| `tools/chapter2_test.cjs` | 13/13 ✔ | Bölüm 2 kara kutu görevi: kilit, tarayıcı yön/mesafe, 4 parça, tipi baskısı, telsizde birleştirme, kayıt/devam |
| `tools/chapter3_test.cjs` | 21/21 ✔ | Bölüm 3 HELIKON salonu: kapı kilidi, katman yalıtımı (salon zemini/duvarları/çapaları yalnız içeride), soğuk + ısı kuyusu, Kaan + ısı hücresi gidiş-dönüşü, güven seçimi (tıklama), stel sırası (03:41 tuzağı), kayıt/devam, render |
| `tools/chapter4_test.cjs` | 19/19 ✔ | Bölüm 4 göl havzası: kapı kilidi, katman yalıtımı, teras/rampa zemini, köprüden önce göl kenarı engeli, sembol taşları (E ve tarayıcı), köprü + zemin, eksik sembolde çevrilmeyen cümle, 3 seçenekli cevap + bölüm sonu kartı, dönüş, kayıt/devam |

Bu turda bulunup düzeltilen hatalar:
- Seçim paneli açılırken fare imleci tuvale kilitli kalıyordu (masaüstünde düğmeler tıklanamıyordu); panel artık kilidi bırakıyor.
- Yatay iPhone'da tarayıcı paneli eylem düğmelerinin, numune paneli koşullar kutusunun üstüne biniyordu; paneller artık ölçülerek alt alta diziliyor.
- Dokunmatik cihazlarda masaüstü klavye ipucu (WASD) görünüyordu; DURAKLAT etiketi düğmeye sığmıyordu (MENÜ).
- Kapalı HELIKON salonunun perde katmanı dokunmatik kontrolleri oyun sırasında gizliyordu (orijinal oyundaki CSS kuralı; iPhone'da da oluşurdu).
- VR bilek göstergesi, tuvali oluşturulmadan çizilmeye çalışılıyordu.
- `setPointerCapture` bırakılmış parmakta istisna atabiliyordu.

## Ölçülen render yükü (SwiftShader)
- Kare başına ~30–34 WebGL çizimi (A3D katmanı ≈12).
- Kare başına ~143 bin üçgen; bunun ~120 bini orijinal arazi → arazi 41×41 parçalara bölünüp görüş konisi dışındakiler çizilmiyor.
- A3D doku belleği: ~84,5 MB (yüksek); düşük kalitede doku ölçeği yarıya iner.

## Varlık doğrulama
- Khronos glTF-Validator: `ice_cave`, `explorer`, `fp_hands` → 0 hata, 0 uyarı; `station` 0 hata. `helikon_hall` (Bölüm 3, 11,9 bin üçgen, 1,7 MB) henüz validator'dan geçirilmedi; oyun içinde yükleniyor ve test ediliyor.

## Uygulama boyutu etkisi
- `Game/` klasörü: **6,3 MB** (modeller ~5 MB + `index.html` 1,34 MB). Uygulama paketi tahmini < 15 MB.

## Bilinen sınırlar
- Swift kodu Linux'ta derlenemedi (iOS SDK yok); ilk Xcode derlemesinde düzeltme gerekebilir.
- VR modu WebXR kullanır: Quest/Vision Pro tarayıcısında çalışır; iPhone WKWebView WebXR desteklemez.
- Orijinal dosyadaki gömülü bazı görsellerin lisansı doğrulanmalı (`VARLIK_LISANSLARI.md`).
