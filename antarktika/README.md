# ANTARKTIKA: WHITEOUT — 3D iOS ve VR sürümü

Orijinal WebGL oyununun (HELIKON hikâyesi, prologue, 6 görev, saha tarayıcısı, kırılgan kargo, hipotermi, HELIKON yeraltı salonu) korunarak genişletilmiş hâli. Bu sürümde:
- Blender'da üretilmiş gerçek 3D mekânlar ve karakter,
- tam kayıt sistemi,
- iPhone için Xcode projesi,
- WebXR VR modu var.

> Bu bölüm, brief'te istenen **dikey dilim**dir: bir araştırma istasyonu, bir buz mağarası ve bir karakter. Diğer bölgeler (verici, kara kutu, HELIKON kapısı, yıldız dizisi) aynı boru hattıyla eklenebilir.

## Klasörler

```
antarktika/
├── original/                 Teslim alınan dosyalar (değiştirilmedi)
├── blender/
│   ├── scripts/              bpy üretim betikleri (Blender 5.2)
│   ├── source/*.blend        Düzenlenebilir kaynaklar (prosedürel materyaller + bake'li oyun mesh'leri)
│   └── textures/             Bake edilmiş PBR dokular (renk, ORM, normal) ve emisyon atlasları
├── ios/
│   ├── Antarktika.xcodeproj  tools/gen_xcodeproj.py ile üretildi
│   └── Antarktika/
│       ├── *.swift           SwiftUI + WKWebView, antarktika:// şema sunucusu, yerel kayıt deposu
│       ├── Info.plist, PrivacyInfo.xcprivacy, Assets.xcassets (AppIcon)
│       └── Game/             Oyun (paket içine mavi klasör olarak girer)
│           ├── index.html    Orijinal oyun + tools/patch_engine.py ile işlenen kancalar
│           ├── js/a3d.js     GLB yükleyici, PBR-lite + iskelet render, LOD/kırpma, çarpışma, bulmacalar, NPC
│           ├── js/save.js    Tam kayıt / devam (localStorage + iOS yerel dosya)
│           ├── js/touch.js   Yüzen analog joystick, doğrudan bakış, bağlama duyarlı E
│           ├── js/perf.js    ?perf=1 performans paneli
│           ├── js/xr.js      WebXR VR modu (Quest / Vision Pro tarayıcısı)
│           └── models/*.glb  station, ice_cave, explorer, fp_hands
├── tools/                    Test, yama, proje ve simge üreticileri
└── docs/                     Rapor, kontrol listesi, lisans kaydı, test çıktıları
```

## Varlıkları yeniden üretmek

```bash
pip install bpy==5.2.3 pillow numpy      # ya da: blender -b -P <betik>
cd antarktika/blender/scripts
python build_station.py      # ~1.5 dk (Cycles bake)
python build_ice_cave.py     # ~2 dk
python build_explorer.py     # ~20 sn
python build_fp_hands.py     # ~15 sn
python build_helikon_hall.py # ~1 dk (Bölüm 3 salonu; explorer.blend'den Kaan'ı pozlar — önce build_explorer)
python build_helikon_city.py # ~4 dk (Bölüm 4 buz altı gölü, 2048 bake)
python build_helikon_grid.py # ~3 dk (Bölüm 5 iletim galerisi, 2048 bake)
```

Her betik `.blend` kaynağını, PNG dokuları ve `Game/models/*.glb` dosyasını yazar. Oyun mantığı GLB düğüm `extras` alanından okunur:
- `COL_` çarpışma, `FLOOR_` zemin/rampa, `VOL_` bölge,
- `INT_` etkileşim, `LIGHT_` ışık, `PATH_` NPC devriye noktası.

Ayrıntı için `blender/scripts/a3d_common.py` başındaki açıklamaya bakın.

## Oyunu yerelde çalıştırmak

```bash
node -e "require('./antarktika/tools/serve.cjs')(8765)"   # http://localhost:8765/index.html
```

`file://` ile açılırsa GLB'ler `fetch` edilemez. Bu durumda oyun orijinal prosedürel sahneyle çalışır.

## Testler

```bash
node antarktika/tools/play_test.cjs  <çıktı>   # oynanış, çarpışma, bulmacalar, kayıt, kalite
node antarktika/tools/touch_test.cjs           # dokunmatik kontroller (mobil emülasyon)
node antarktika/tools/chapter2_test.cjs        # Bölüm 2: kara kutu görevi + kayıt
node antarktika/tools/chapter3_test.cjs [çıktı] # Bölüm 3: HELIKON salonu, Kaan, steller, kayıt
node antarktika/tools/chapter4_test.cjs [çıktı] # Bölüm 4: göl havzası, kristal dili, köprü, üç cevap, kayıt
node antarktika/tools/chapter5_test.cjs [çıktı] # Bölüm 5: son uçak, iletim galerisi, kablo, düğümler, karartma, senkronoskop, yük seçimi, kayıt
node antarktika/tools/hall_shots.cjs  <çıktı>   # Bölüm 3 salonu + Bölüm 4 havzasından oyun içi kareler
node antarktika/tools/xr_test.cjs    <çıktı>   # VR yolu (sahte WebXR oturumu)
node antarktika/tools/verify_terrain_port.mjs  # Python arazi portu = JS orijinal
```

Testler başsız Chromium'da yazılımsal WebGL (SwiftShader) kullanır ve `?forcewebgl=1` gerektirir. Ölçülen FPS iPhone için anlamlı **değildir**; bkz. `docs/RAPOR.md`.

## iOS derlemesi

`ios/Antarktika.xcodeproj` dosyasını Xcode 16+ ile açın, Team ve Bundle ID'yi ayarlayın, ardından **Build/Archive** yapın. Adım adım liste: `docs/TESTFLIGHT_KONTROL_LISTESI.md`.

## Motor değişiklikleri

`Game/index.html`, `original/index.html` dosyasına `tools/patch_engine.py` uygulanarak üretilir. Her değişiklik o dosyada tek tek ve gerekçesiyle durur. Her eşleşme sayısıyla doğrulanır; orijinal değişirse yama açıkça hata verir.
