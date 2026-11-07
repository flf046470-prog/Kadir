# Varlık ve lisans kaydı — ANTARKTIKA: WHITEOUT

Bu kayıt, uygulama paketine giren her görsel, ses ve yazı tipi varlığının nereden geldiğini listeler. Ücretli satıştan önce **"Kontrol gerekli"** satırlarının sahibi tarafından kapatılması gerekir.

## Bu çalışmada üretilen varlıklar (ticari kullanım: serbest)

Aşağıdaki varlıkların hepsi bu repodaki betiklerle sıfırdan, prosedürel olarak üretildi. Hiçbir dış model, doku, HDRI, eklenti ya da yapay zekâ görüntüsü kullanılmadı. Kaynak kod ve `.blend` dosyaları repodadır.

| Varlık | Üreten betik | Not |
| --- | --- | --- |
| `models/station.glb`, `source/station.blend` | `blender/scripts/build_station.py` | Geometri, materyal ve bake'ler özgün |
| `models/ice_cave.glb`, `source/ice_cave.blend` | `blender/scripts/build_ice_cave.py` | Buz sarkıtları, işaret ve kristaller özgün |
| `models/explorer.glb`, `source/explorer.blend` | `blender/scripts/build_explorer.py` | İskelet ve 4 animasyon elle keyframe'lendi |
| `models/fp_hands.glb`, `source/fp_hands.blend` | `blender/scripts/build_fp_hands.py` | Eldivenler, fener, tarayıcı |
| `textures/*_basecolor/orm/normal.png` | Cycles bake (aynı betikler) | Blender'ın prosedürel düğümlerinden |
| `textures/screens_atlas.png` | `blender/scripts/screens.py` | Pillow ile çizildi |
| `textures/cave_emissive.png`, `fp_hands_emissive.png` | ilgili betikler | Pillow ile çizildi |
| `Assets.xcassets/AppIcon.appiconset/Icon.png` | `tools/make_icon.py` | Pillow ile çizildi; alfa kanalı yok |
| Oyun içi sesler (rüzgâr, adım, jeneratör, kristal, telsiz) | `Game/js/a3d.js` ve orijinal motor | Web Audio ile çalışma anında sentezleniyor; ses dosyası yok |

## Kullanılan araçlar ve yazı tipleri

| Öğe | Lisans | Ticari kullanım |
| --- | --- | --- |
| Blender 5.2 (`bpy`) | GPL-3.0 | Blender ile üretilen çıktılar kullanıcıya aittir; GPL çıktıları kapsamaz |
| Pillow, NumPy | HPND, BSD-3 | Yalnızca üretim aracı; uygulamaya gömülü değil |
| DejaVu Sans Mono (ekran dokularına yazı olarak işlendi) | Bitstream Vera / DejaVu lisansı | Serbest. Görüntüye işlenmiş metin için kısıt yok; yazı tipi dosyası uygulamaya gömülmedi |

## Kontrol gerekli — orijinal `index.html` içindeki gömülü görseller

Bu görseller bana orijinal oyun dosyasının içinde base64 olarak geldi. Kaynaklarını doğrulayamadım.

| Görsel | Boyut | Gözlem | Gereken işlem |
| --- | --- | --- | --- |
| `#overlay` arka planı (menü fotoğrafı) | 1536×866 WebP | Fotogerçekçi kar, dağ ve bot görüntüsü. Yapay zekâ ya da stok görsel olabilir | Kaynağı ve lisansı belgeleyin ya da değiştirin |
| `#iceSky` (gökyüzü panoraması) | 2048×1024 WebP | Gerilmiş bir bulut fotoğrafı | Kaynağı ve lisansı belgeleyin ya da değiştirin |
| `#iceAtlas` (kar/buz/kaya atlası) | 2048×2048 WebP | Prosedürel gürültü dokusuna benziyor | Kaynağını teyit edin |

Bu üç görseli, istenirse Blender'da prosedürel olarak yeniden üretebilirim. O zaman uygulamadaki tüm görsellerin kaynağı belgelenmiş olur.

## Üçüncü taraf bağlantılar

**Meshy kütüphane paneli:** Oyundaki "EKİP" (K) paneli `meshy.ai` adresindeki topluluk modellerine bağlantı veriyor ve kullanıcının kendi GLB dosyasını yüklemesine izin veriyor (bu özellik orijinal oyunda vardı).
- Uygulama bu modellerin hiçbirini **paket içinde taşımıyor**.
- Bağlantılar iOS'ta Safari'de açılıyor.
- Bu panel ücretli bir sürümde tutulacaksa App Review notlarında açıklanmalı. Kaldırılması da bir seçenek; karar sahibinindir.
