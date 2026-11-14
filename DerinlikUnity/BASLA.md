# DERİNLİK (Unity) — Başla

Bu klasör bir Unity 6 projesi. Projeyi ilk açtığında **Sakarya prototip sahnesi kendiliğinden kurulur**; sen yalnızca Play'e basarsın.

## 1. Bir kez kurulum
1. **Unity Hub**'ı kur: https://unity.com/download
2. Hub → Installs → **Unity 6 LTS** (6000.0.x) kur. Modüllerden yalnızca *Windows Build Support* yeterli. Visual Studio isteğe bağlıdır; 8 GB RAM'de VS Code daha hafif kalır.
3. Depoyu indir (Git LFS ile):
   ```powershell
   git lfs install
   git clone https://github.com/flf046470-prog/Kadir.git
   cd Kadir
   git checkout claude/amazing-allen-jnpr5e
   ```

## 2. Projeyi aç
1. Unity Hub → **Projects → Add → Add project from disk** → `Kadir/DerinlikUnity` klasörünü seç.
2. Hub sürüm sorarsa kurduğun **Unity 6** sürümünü seç ve "Open with…" de.
3. İlk açılış birkaç dakika sürer (Library oluşturuluyor). Bu sırada tarayıcıyı kapat.
4. Açılınca Console'da `[Derinlik] Sakarya prototype built` satırını görürsün ve `Sakarya_Proto` sahnesi açılır.
   - Görmezsen: üst menü → **Derinlik → Sakarya Prototipini Kur**.
   - "Input System… enable backends / restart?" penceresi çıkarsa **Yes** de. Kod her iki giriş sistemiyle de çalışır.
5. Üstteki **▶ Play** düğmesine bas. Oyun penceresine bir kez tıklayınca fare kilitlenir.

## 3. Kontroller
| Tuş | İşlev |
|---|---|
| W A S D / fare | Yürü / bak |
| Shift | Koş (yalnızca ileri giderken) |
| Ctrl veya C | Çömel / kalk (üstte yer yoksa kalkmaz) |
| F | El feneri |
| E | Etkileşim (kapı, kaset) |
| Sağ tık veya Q | Video kamerayı kaldır/indir |
| Esc | Fareyi serbest bırak |

## 4. Prototipin akışı (3–5 dakika)
1. Karanlık ekranda mesaj: *"03.17'den önce oraya var…"*
2. **Bodrum:** loş ampul, raflar, uğultu. Kuzeydeki ahşap kapıyı **E** ile aç.
3. **Koridor A:** alçak tavan, **çömelmen** gerekir. Su damlıyor.
4. Koridorun sonu taş bir levhayla kapalı ve çıplak gözle bir şey görünmüyor. **Sağ tıkla kamerayı kaldır** → İlk Kayıtçılar mührü parlıyor. **2 saniye ortada tut** → levha yere iner.
5. **Koridor B:** açık duran kapıdan geç. Biraz ilerleyince kapı arkanda **çarparak kapanır ve kilitlenir**, ampul söner, uzakta ayak sesleri duyulur.
6. **Kontrol odası:** masadaki MiniDV kaseti **E** ile al → ekran kararır → **"KAPI 01 — SAKARYA"**.

## 5. Test listesi (sonuçları bana yaz)
| Test | Beklenen |
|---|---|
| Kapıya bak | Ekranda `[E] Aç`; açılınca `[E] Kapat` |
| Koridor A'da ayakta yürü | Alçak tavanda takılırsın; çömelince geçersin |
| Tavan altında kalkmayı dene | Kalkmaz |
| Kamera kapalıyken levhaya bak | Mühür görünmez |
| Kamera açık, 2 sn ortada tut | Mavi çubuk dolar, levha iner |
| Koridor B'ye gir | Kapı çarpar, kilitlenir (`[E] Kilitli`), ışık söner, ayak sesleri |
| Kaseti al | Kararma ve bölüm başlığı |
| Stats (Game penceresi → Stats) | FPS değerini not et |

## 6. Neler kodla yapıldı, neler senin elinde?
- Sahne, materyaller, ışıklar ve sesler `Assets/Derinlik/Editor/SakaryaPrototypeBuilder.cs` tarafından **kodla** üretilir. Sesler de kodla sentezlenir; üçüncü taraf ses kullanılmadığı için lisans sorunu yok.
- Görünüm şimdilik **greybox** (gri kutular ve gürültü dokuları). Fotogerçekçi modeller ve dokular Phase 2'de gelecek: Meshy, Fab ve Unity Asset Store (lisansları kontrol edilerek).
- Sahneyi sıfırdan kurmak istersen: **Derinlik → Sakarya Prototipini Kur**. Bu, sahnede yaptığın değişiklikleri siler; önce onay ister.

## 7. Sorun giderme
- **Pembe/mor nesneler:** Edit → Project Settings → Graphics'te bir render pipeline seçiliyse ve shader uyuşmazsa olur. Menüden **Derinlik → Sakarya Prototipini Kur** ile sahneyi yeniden kur (materyaller mevcut pipeline'a göre yeniden üretilir).
- **Çok karanlık / çok aydınlık:** `Bulb_*` ışıklarının Intensity değerini veya el fenerinin (`Player/Camera/FlashlightBeam`) yoğunluğunu değiştir.
- **Console'da kırmızı hata:** metnini olduğu gibi bana gönder.
