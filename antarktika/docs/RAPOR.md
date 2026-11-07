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

## Ölçülen render yükü (SwiftShader)
- Kare başına ~30–34 WebGL çizimi (A3D katmanı ≈12).
- Kare başına ~143 bin üçgen; bunun ~120 bini orijinal arazi → arazi 41×41 parçalara bölünüp görüş konisi dışındakiler çizilmiyor.
- A3D doku belleği: ~84,5 MB (yüksek); düşük kalitede doku ölçeği yarıya iner.

## Varlık doğrulama
- Khronos glTF-Validator: `ice_cave`, `explorer`, `fp_hands` → 0 hata, 0 uyarı; `station` 0 hata.

## Uygulama boyutu etkisi
- `Game/` klasörü: **6,3 MB** (modeller ~5 MB + `index.html` 1,34 MB). Uygulama paketi tahmini < 15 MB.

## Bilinen sınırlar
- Swift kodu Linux'ta derlenemedi (iOS SDK yok); ilk Xcode derlemesinde düzeltme gerekebilir.
- VR modu WebXR kullanır: Quest/Vision Pro tarayıcısında çalışır; iPhone WKWebView WebXR desteklemez.
- Orijinal dosyadaki gömülü bazı görsellerin lisansı doğrulanmalı (`VARLIK_LISANSLARI.md`).
