# TestFlight ve gerçek iPhone test kontrol listesi

Bu listedeki her adım gerçek cihazda yapılmalı. Bu repoda yaptığım testler yalnızca masaüstü Chromium'da yazılımsal WebGL ile çalıştı (bkz. `RAPOR.md`). Bu nedenle iPhone'da FPS, bellek ve ısınma **ölçülmüş değildir**.

## 1. Arşivlemeden önce (Mac + Xcode 16 veya üstü)

- [ ] `ios/Antarktika.xcodeproj` dosyasını açın. Hedef: **Antarktika**.
- [ ] *Signing & Capabilities* bölümünde Team'i seçin. `PRODUCT_BUNDLE_IDENTIFIER` değerini kendi App ID'nizle değiştirin; şu an yer tutucu olarak `com.yourcompany.antarktika-whiteout` yazılı.
- [ ] *General* bölümünde Version `1.0.0` ve Build `1` değerlerini kontrol edin.
- [ ] Project navigator'da `Game` klasörünün **mavi klasör referansı** olarak göründüğünü doğrulayın. Bu, `models/` ve `js/` klasörlerinin pakete girmesi için gerekli.
- [ ] *Product ▸ Build* çalıştırın. Swift dosyaları bu ortamda derlenemedi, bu ilk derleme olacak. Uyarı ve hataları not edin.
- [ ] `Assets.xcassets ▸ AppIcon`: 1024×1024 PNG, alfa kanalı yok (`tools/make_icon.py` ile üretildi).
- [ ] `PrivacyInfo.xcprivacy`: Uygulama takip yapmıyor ve veri toplamıyor. Gerekçe gerektiren API kullanılmıyor; `SaveStore` yalnızca FileManager/Data kullanıyor.
- [ ] App Store Connect ▸ App Privacy bölümünde "Veri toplanmıyor" seçeneğini işaretleyin.

## 2. İlk açılış (Debug, kabloyla bağlı cihaz)

- [ ] Uygulama yatay açılıyor; durum çubuğu ve ana ekran çizgisi gizli.
- [ ] Menü altbilgisi önce "3D DÜNYA YÜKLENİYOR · %…", sonra normal metin gösteriyor. Süreyi not edin.
- [ ] Mac'teki Safari ▸ Develop ▸ [iPhone] ▸ Antarktika konsolunda hata olmamalı. Debug derlemede `isInspectable` açık.
- [ ] Uçak modunda da yukarıdakilerin hepsi çalışıyor (çevrimdışı).

## 3. Oynanış (her biri gerçek dokunmatik kontrollerle)

- [ ] Sol yarıya dokunulduğunda yüzen joystick parmağın altında beliriyor. Hafif itince yürüyor, sonuna kadar itince koşuyor.
- [ ] Sağ yarıda sürükleyerek bakış akıcı; yukarı/aşağı sınırları doğru.
- [ ] Prologue 1: kamptaki ekipman (E).
- [ ] Prologue 2: rampadan çıkınca kapı açılıyor ve içeri giriliyor. Telsiz "ENERJİSİZ" diyor; jeneratörü (E) çalıştırınca ışıklar yanıyor ve telsiz çalışıyor.
- [ ] Prologue 3: kuzeyde Q ile tarama.
- [ ] Prologue 4: buz mağarası. F ile fener açılıyor; dipteki işarette E.
- [ ] Dr. Selin devriye geziyor; yaklaşınca dönüp bakıyor, E ile konuşuyor (el sallıyor, ipucu veriyor).
- [ ] Görev 03: lab terminali (ipucu 03:17), frekans çözücüde E ile 3.17 MHz seçiliyor, görev ilerliyor.
- [ ] Mağara kristalleri: yanlış sıra sıfırlıyor; mavi → altın → mor sırası çekirdeği açıyor; Q ile tara, E ile topla.
- [ ] Duvarların, korkulukların ve mağara duvarlarının içinden geçilemiyor; kamera duvara girmiyor.
- [ ] Hipotermi: dışarıda vücut ısısı düşüyor, istasyon içinde hızla artıyor.

## 4. Kayıt

- [ ] Oyunun ortasında uygulamayı ana ekrana gönderin, sonra uygulama değiştiriciden tamamen kapatın.
- [ ] Yeniden açın: "DEVAM ET · <görev> · <dk>" görünüyor ve konum, görev, bulmacalar ile günlük geri geliyor.
- [ ] Cihazı yeniden başlatıp tekrar deneyin. Native dosya şurada olmalı: `Application Support/Antarktika/save-v1.json`.
- [ ] "YENİ SEFER" iki aşamalı onay istiyor ve kaydı siliyor.

## 5. Performans ve bellek (Instruments)

- [ ] `?perf=1` yerine pusulaya üç kez dokunun: FPS, p95 kare süresi ve draw call sayısı görünüyor.
- [ ] Desteklenen en eski cihazda (ör. iPhone 11/12) ve bir güncel cihazda üç kalitede ölçüm yapın:
  - [ ] ORTA: istasyon dışı, istasyon içi, mağara içi. Hedef ≥ 30 FPS sabit.
  - [ ] DÜŞÜK: zayıf cihazda ≥ 30 FPS.
  - [ ] YÜKSEK: güncel cihazda ölçün; hedef 60 FPS.
- [ ] Instruments ▸ Allocations ve Activity Monitor ile WebContent sürecinin belleğini ölçün. Doku belleği tahmini ORTA'da yaklaşık 45 MB, YÜKSEK'te yaklaşık 85 MB.
- [ ] 20 dakika oynayın; termal durum ve FPS düşüşünü not edin.
- [ ] Web süreci düşerse (`webViewWebContentProcessDidTerminate`) oyun "DEVAM ET" menüsüne dönüyor ve kayıt korunuyor.

## 6. Ses ve sistem

- [ ] Sessiz anahtar açıkken oyun sesi kapanıyor (`.ambient` kategori). Arka planda müzik çalarken oyun sesi onu kesmiyor.
- [ ] Telefon araması gelince oyun duraklıyor ve kayıt alınıyor.
- [ ] Bluetooth oyun kumandası (MFi veya Xbox) çalışıyor; orijinal motorda Gamepad API desteği var.

## 7. TestFlight

- [ ] *Product ▸ Archive* ▸ *Distribute App* ▸ *TestFlight & App Store*.
- [ ] İhracat uyumluluğu: `ITSAppUsesNonExemptEncryption = NO` zaten ayarlı.
- [ ] Dahili test grubunda en az 3 farklı iPhone modeliyle 1–3. ve 5. bölümleri tekrarlayın.
- [ ] Çökme raporlarını Xcode ▸ Organizer ▸ Crashes'ten kontrol edin.

## 8. App Store gönderimi

- [ ] Ekran görüntüleri (6.9" ve 6.5") ile tanıtım videosu yüklendi.
- [ ] Yaş derecelendirmesi: şiddet yok, korku teması hafif → 9+ uygun görünüyor; formda doğrulayın.
- [ ] `VARLIK_LISANSLARI.md` içindeki "Kontrol gerekli" satırları kapatıldı.
- [ ] App Review notu: oyun tamamen çevrimdışı; hesap yok; Meshy paneli kullanıcı dosyası yüklüyor ve hiçbir şey sunucuya gitmiyor.
