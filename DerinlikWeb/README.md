# DERİNLİK — The Depths: Echoes of the Forgotten (tarayıcı sürümü)

Birinci şahıs psikolojik korku oyunu. Dört bölüm, her bölümde kalıcı kararlar, yedi son. Kurulum gerektirmez: tek bir HTML dosyası, Three.js ile çalışır.

| Bölüm | Yer | Ne olur |
|---|---|---|
| 1 · KAPI | Sakarya, bodrum | E-posta (aktarım kodu PLM-01), Deniz Arat'ın duvar kazıması, çömelerek geçilen tünel, paslı çarkla inen taş levha, çarpan kapı, Deniz'in kaseti. **Karar:** jeneratörün son devresi POMPA'ya (Deniz kurtulur) ya da AKTARIM'a (görüntü Paris'e gider, Deniz boğulur) |
| 2 · HAFIZA | Nevşehir, yeraltı şehri | Üç taş kadranı, yalnızca kamerada görünen simgelere göre çevir. Kil tablet, yalnızca kamerada görünen Élise. **Karar:** adının yazılı kil mührü al ya da onu kaydet |
| 3 · SIFIR-17 | Kola Yarımadası, 2028 (1986'da terk edilmiş) | Volkova koridorda devriye geziyor (gizlenme), deney günlüğü, rezonans konsolu. **Kararlar:** Deniz hayattaysa onu yem olarak bırak ya da birlikte saklan; 417 Hz (reaktör kapısı açılır, Volkova serbest) ya da 528 Hz (Volkova donar, kapı kilitli kalır, havalandırma kanalından geçilir) |
| 4 · SON TANIK | Paris, PALİMPSEST arşivi | Dr. Camille Moreau'nun itirafı (önceki kararlara göre değişir), Élise'in çizimi. **Kararlar:** kamerayı Camille'e ver ya da kapıyı onun önüne indir; sonra SİL, YAYINLA ya da kapı |

**Sonlar (yedi, hepsi kesin; hiçbiri başa dönmez):** *Eve Dönüş* (Camille kapıyı açar, Élise'in adı seninle) · *Geri Gelen* (Camille kapıyı açar, Élise kayıtta) · *İki Tanık* (SİL, Deniz hayatta) · *Unutulan* (SİL, Deniz kayıp) · *Yeni Dünya* (YAYINLA, 417 Hz) · *Kanıt* (YAYINLA, 528 Hz) · *Son Bekçi* (Camille kapının ardında, kapının içine gir). Son karar verilince kayıt silinir; başka bir son için baştan oyna.

## Oynamak
- **Bilgisayarda:** `dist/index.html` dosyasını Chrome, Edge ya da Firefox ile aç. Three.js `cdn.jsdelivr.net` üzerinden yüklendiği için internet bağlantısı gerekir.
- **İnternetsiz (masaüstü / Steam):** `dist/offline/index.html` her şeyi içinde taşır (Three.js ve yazı tipleri gömülü); bağlantı gerekmez. Masaüstü uygulaması bu dosyayı kullanır: `../DerinlikDesktop/README.md`.
- **Pause menüsünde "Görüntü kalitesi":** Yüksek (tam dokular, bloom, gölgeli lamba, yansımalar) · Orta (512 px dokular, daha hafif efektler) · Düşük (efektsiz).
- **Kontroller:** W A S D + fare (fare kilitlenemezse sol tıkla sürükleyerek bak) · Shift koş · F el feneri · Q / sağ tık video kamera · C / Ctrl çömel · E etkileşim · Tab kanıt arşivi · Esc duraklat.
- **Telefon / tablet:** sol altta hareket çubuğu, sağda düğmeler, ekranın sağ yarısında sürükleyerek bak.
- **Kayıt:** her bölüm başında ve her kararda tarayıcıya kaydedilir (`derinlik.save.v2`); başlangıç ekranında “Devam et” çıkar. Devam edince bölüm verdiğin kararlarla yeniden kurulur ve verilmiş bir karar bir daha sorulmaz. Bozuk kayıt ve eski hikâyenin v1 kaydı sessizce silinir.

## Derlemek
```bash
# 1) Blender ile özgün sahne objelerini üret (isteğe bağlı; yoksa oyun gri kutularla çalışır)
blender -b --factory-startup -P DerinlikWeb/tools/make_props.py
# 2) Blender ile gerçekçi PBR dokuları pişir (toprak, çamur, buz, kırağı, kar, tüf, kireçtaşı, tuğla, pas…; ~10 dk)
blender -b --factory-startup -P DerinlikWeb/tools/bake_textures.py
# 3) game.html + models/*.glb + textures/* + src/fx-*.js -> dist/index.html (hepsi tek dosyaya gömülür)
python3 DerinlikWeb/build.py
# 4) İnternetsiz sürüm (Three.js esbuild ile paketlenir, OFL yazı tipleri gömülür); önce bir kez: cd DerinlikWeb && npm install
python3 DerinlikWeb/build.py --offline --out dist/offline/index.html
```
`build.py --only lighting,post` yalnızca seçili modüllerle, `--none` modülsüz derler (karşılaştırma ve hata ayıklama için).
Blender'ın glTF dışa aktarıcısı `numpy` ister (Debian/Ubuntu: `apt install python3-numpy`).

## Dosyalar
| Dosya | İçerik |
|---|---|
| `game.html` | Oyunun tamamı: sahneler, ışık, ses sentezi, oyuncu, kapılar, kamera, kanıt/Yankı/mühür, düşman, kayıt, menüler, dokunmatik kontroller |
| `tools/make_props.py` | Blender betiği: sandalye, sandık, duvar apliği, mum kümesi, şamdan, vana çarkı, makaralı kayıt cihazı, dosya dolabı, Sovyet radyosu, kafatası, uyluk kemiği ve karakter figürü (laboratuvar önlüklü, 1,70 m; oranlar Winter/Drillis-Contini vücut segment tablosundan) |
| `models/` | Betiğin ürettiği GLB dosyaları ve `manifest.json` |
| `tools/bake_textures.py` | Blender betiği: 16 gerçek-dünya yüzeyinin dikişsiz PBR dokuları (renk, normal, AO/pürüzlülük/metal) |
| `textures/` | Pişirilmiş dokular (~5 MB JPEG) |
| `src/fx-materials.js` | Dokuları malzemelere giydirir; bölüme göre zeminler (çamur, toprak, ıslak beton), duvar dibinde nem ve tuz izi, SIFIR-17'de kırağı, su birikintileri, donmuş su, buz sarkıtları, kar yığını, alev isi |
| `src/fx-lighting.js` | El feneri: LED reflektör deseni, ışığın çarptığı yerden sekme ışığı, kovalanırken titreme. Lambalarda hale, cereyanda sallanan ve kapı çarpınca savrulan ampuller, Yüksek'te gölgeli lamba, su ve buz için ortam yansıması |
| `src/fx-post.js` | Görüntü sonrası: yalnızca gerçek ışık kaynaklarında bloom, bölüme göre renk ayarı, lens vinyeti, film greni, hafif renk sapması, Yankı bozulması, video kamerada DV NightShot görünümü |
| `package.json` | İnternetsiz derleme araçları (esbuild, three 0.160.0, @fontsource yazı tipleri) |
| `src/README.md` | Gerçekçilik modüllerinin sözleşmesi |
| `build.py` | `dist/index.html` üretir |

## Varlıklar ve lisans
- Bütün dokular, sesler ve modeller kodla üretilir; üçüncü taraf dosya yoktur.
- Three.js 0.160.0 (MIT) CDN'den yüklenir. Yazı tipleri: IBM Plex Sans Condensed ve VT323 (SIL Open Font License), Google Fonts'tan. İnternetsiz sürümde ikisi de npm paketlerinden (`three`, `@fontsource/*`) dosyaya gömülür.
- Meshy.ai modelleri bu sürümde **yok**: bulut ortamından `api.meshy.ai` adresine erişim engelli (HTTP 403). Kendi bilgisayarında `python Derinlik/Tools/Meshy/meshy_generate.py` ile üretilen `Derinlik/SourceArt/Meshy/<Ad>/model.glb` dosyasını `DerinlikWeb/models/<ad>.glb` olarak kopyala, `models/manifest.json`'a `"<ad>": {"place": "..."}` ekle ve `game.html` içinde `prop('<ad>', [x, y, z], dönüş)` satırıyla yerleştir; `build.py` onu da gömer. Dokulu Meshy modelleri birkaç MB tutabilir; tek dosyalı sayfa için toplam boyutu 16 MB'ın altında tut.

## Testler
Oyun, `window.__derinlik` test kancalarıyla (zamanı `advance()` ile ilerletme, `DEBUG.manual`, `DEBUG.enemyOff`) Playwright + Chromium'da otomatik oynatıldı. Senaryolar: her son için kararları gerçek etkileşimlerle veren baştan sona oynanış; her bölümün her karar sonrası “Devam et” ile yeniden kurulması; `endingFor` için bütün geçerli karar bileşimleri; gizlenme, yakalanma ve kayıt noktası; duraklatma; kayıttan devam; bozuk kayıt.
