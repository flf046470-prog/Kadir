# DERİNLİK — PHASE 0: Teknik Proje Raporu

Tarih: 2026-10-10 · Durum: Phase 0 tamamlandı, Phase 1 / Görev 1.1 (C++ iskelet) yazıldı, **henüz derlenmedi**.

---

## 0. Mevcut durumun incelenmesi (gerçek bulgular)

| Kontrol | Sonuç |
|---|---|
| Depoda Unreal projesi (`.uproject`) | **Yoktu.** `flf046470-prog/Kadir` deposu bir Next.js web sitesi (Patagonia Underground) içeriyor. |
| Motor sürümü | Doğrulanamadı — bu bulut ortamında Unreal Engine kurulu değil. |
| Unreal Editor / MCP bağlantısı | **Yok.** Editörü açamam, `.uasset`/`.umap` oluşturamam, derleyemem, oyunu çalıştıramam. |
| Karar | Oyun, mevcut siteyi bozmamak için depoda ayrı bir `Derinlik/` klasörüne kuruldu. İstersen ileride ayrı bir depoya (`Derinlik` reposu) taşımanı öneririm. |

---

## 1. Donanım uygunluk değerlendirmesi

**RTX 4050 (Laptop):** 6 GB VRAM (masaüstü varyantı yok sayılırsa). Görev Yöneticisi → Performans → GPU → "Ayrılmış GPU belleği" ile doğrula.
**8 GB sistem RAM:** asıl darboğaz bu.

| Konu | Değerlendirme |
|---|---|
| UE5 Editor'ü açmak | Mümkün, ama boş proje ~3–4 GB RAM kullanır. Windows + tarayıcı ile birlikte sınırdasın. |
| İlk C++ derlemesi | **Riskli.** Visual Studio + UBT paralel derleme 8 GB'ı aşabilir → çok yavaş/çökme. Çözüm aşağıda. |
| Shader derleme | İlk açılışta 10–40 dk sürebilir; ShaderCompileWorker sayısını sınırla. |
| Lumen / Nanite | Nanite sorunsuz (bellek dostu). Lumen başlangıçta **kapalı**; Phase 2'de "Lumen Software" denenecek. |
| Donanım ışın izleme | **Kapalı.** |
| Virtual Shadow Maps | Başlangıçta kapalı (VRAM tasarrufu). |
| Quixel/Fab Megascans | Kullanılabilir ama **2K doku** sınırıyla içe aktar; 8K asla. |

**8 GB için zorunlu ayarlar**
1. Windows sanal belleği (pagefile): SSD'de sistem tarafından yönetilen veya en az 16 GB.
2. `%APPDATA%\Unreal Engine\UnrealBuildTool\BuildConfiguration.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8" ?>
   <Configuration xmlns="https://www.unrealengine.com/BuildConfiguration">
     <ParallelExecutor><MaxProcessorCount>2</MaxProcessorCount></ParallelExecutor>
   </Configuration>
   ```
3. Editor Preferences → General → Performance → "Use Less CPU when in Background" açık.
4. Derleme sırasında tarayıcıyı kapat. Editör + Visual Studio + Chrome aynı anda = yetersiz.
5. Engine Scalability: **Medium**, ekran yüzdesi 75–100.
6. Ölçüm: `stat fps`, `stat unit`, `stat memory`, `stat gpu`, `memreport -full`.

**RAM yükseltme planı (16/32 GB):** Lumen Software GI + Virtual Shadow Maps aç, Scalability Epic/High dene, doku sınırını 4K'ya çıkar, derleme işlemci sınırını kaldır.

**Gerekli programlar:** Epic Games Launcher + UE 5.x (en güncel kararlı), Visual Studio 2022 Community ("Game development with C++" iş yükü + .NET), Git + **Git LFS**, isteğe bağlı GitHub Desktop.

---

## 2. Proje yapısı

```
Derinlik/
├─ Derinlik.uproject
├─ Config/                      (Default*.ini — düşük bellek ayarları)
├─ Source/Derinlik/
│  ├─ Public|Private/Player/        ADerinlikCharacter
│  ├─ Public|Private/Interaction/   IDerinlikInteractable, ADerinlikDoor
│  ├─ (sonra) Camcorder/            UDerinlikCamcorderComponent
│  ├─ (sonra) Echo/                 UDerinlikEchoComponent (Yankı Seviyesi)
│  ├─ (sonra) Evidence/             UEvidenceSubsystem + UEvidenceDataAsset
│  ├─ (sonra) Horror/               UHorrorEventSubsystem
│  └─ (sonra) Save/                 UDerinlikSaveGame + USaveSubsystem
├─ Content/Derinlik/              (Editörde oluşturulacak)
│  ├─ Core/       BP_DerinlikCharacter, BP_DerinlikGameMode
│  ├─ Input/      IMC_Default, IA_Move, IA_Look, IA_Sprint, IA_Crouch, IA_Flashlight, IA_Interact
│  ├─ Interaction/ BP_InteractiveDoor ...
│  ├─ UI/         WBP_HUD, WBP_InteractionPrompt
│  ├─ Maps/       L_Sakarya_Proto
│  ├─ Environment/Sakarya/  (Meshes, Materials, Textures)
│  └─ Audio/      (MetaSounds, SoundClasses)
└─ Docs/
```

**C++ / Blueprint ayrımı:** Çekirdek mantık (hareket, etkileşim izi, kayıt, Yankı, kanıt verisi) C++; içerik ve ayar (meshler, sesler, korku olaylarının zamanlaması, UI) Blueprint. Önerilen `BP_*` isimleri, C++ sınıflarının Blueprint çocukları olarak korunuyor.

**Sistem bağımlılıkları (gevşek bağlı):**
- Karakter → yalnızca `IDerinlikInteractable` arayüzünü bilir; kapıyı, notu vs. tanımaz.
- Kamera → Yankı'ya olay gönderir (event dispatcher), Yankı → HorrorEvent'e seviye değişimini yayınlar.
- Save → diğer sistemlerin `SaveGame` işaretli değişkenlerini toplar; sistemler Save'i bilmez.
- Kimlikler için **Gameplay Tags** (`Evidence.Sakarya.Video01`, `Door.Sakarya.Basement` …).

---

## 3. Mekaniklerin öncelik sırası

1. Birinci şahıs hareket + el feneri ← **yazıldı (1.1)**
2. Tek etkileşim arayüzü + kapı ← **yazıldı (1.1)**
3. Etkileşim HUD istemi (UMG)
4. Video kamera: aç/kapa görünümü + yalnızca kamerada görünen sembol (Custom Depth / material parameter)
5. Korku olay yöneticisi (tetik kutusu → olay listesi; deterministik)
6. Bölüm sonu tetikleyici + basit fade
7. Yüzeye göre ayak sesi (Physical Materials)
8. Kanıt verisi + Yankı Seviyesi
9. SaveGame (sürüm numaralı, bozuk kayıtta varsayılana dönen)
10. Bulmaca sistemi, envanter/arşiv UI, ayarlar menüsü
11. Düşman/gizlenme (Phase 5'e kadar yok)

---

## 4. Sakarya prototipi (3–5 dakika) — somut tasarım

Harita: `L_Sakarya_Proto` — toplam ~25 × 15 m, tek seviye, streaming yok.

| # | Alan | Oyuncu ne yapar | Sistem |
|---|---|---|---|
| 1 | **Bodrum merdiveni altı** (4×5 m, beton, tek çıplak ampul titrer) | Başlangıç. Telefon notu: "03.17'den önce…" | Not etkileşimi |
| 2 | **Bodrum** (8×6 m, nemli sıva, eski raflar) | El fenerini açar. Rafın arkasında aralık. | El feneri |
| 3 | **Ahşap kapı** (`BP_InteractiveDoor`) | Açar, dar taş geçide girer. | Kapı |
| 4 | **Koridor A** (1.2 m genişlik, 10 m, kaba taş, su damlası) | Çömelerek alçak bir bölümden geçer. | Çömelme |
| 5 | **Koridor A sonu** — duvar boş görünür | Kamerayı açınca duvarda **İlk Kayıtçı sembolü** görünür. Kamerayla 2 sn bakınca taş kayar. | Kamera + gizli sembol |
| 6 | **Koridor B** (8 m, daha eski işçilik) | Yürürken arkadaki ahşap kapı **kendiliğinden çarpar**; ampul söner; uzakta tek bir ayak sesi. | Korku olayı (tetik kutusu, bir kez) |
| 7 | **Küçük kontrol odası** | Masadaki kamera kasetini alır → ekran kararır: "KAPI 01 — SAKARYA". | Bölüm sonu tetikleyici |

Sıçratma yok; tek korku anı zemini hazırlıyor ("buradan çıkış kalmadı").

---

## 5. Kim ne yapar?

**Benim doğrudan yapabildiklerim (bu ortamda):**
- C++ sınıfları, `.Build.cs`, `.ini` yapılandırmaları, `.gitignore`/`.gitattributes`
- Editör Python betikleri (senin bilgisayarında çalıştırman gerekir)
- Tasarım, mimari, test planları, hata ayıklama (sen log/hata gönderirsen)
- Git commit/push

**Yapamadıklarım:** derlemek, Editörü açmak, `.uasset`/`.umap` oluşturmak, oyunu test etmek, performans ölçmek. Bunları sen yapıp sonuçları (Output Log, hata metni, `stat unit` ekran görüntüsü) bana gönderiyorsun.

**Senin Unreal Editor'da yapacakların:** Input asset'leri, Blueprint çocukları, harita/blockout, materyaller, ışık, UI widget'ları, ses asset'leri.

---

## 6. İlk hafta planı

| Gün | Görev | Başarı kriteri |
|---|---|---|
| 1 | Programları kur, pagefile + BuildConfiguration.xml, VRAM'i doğrula | UE açılıyor, VS 2022 kurulu |
| 2 | **Görev 1.1**: projeyi aç, derle, input asset'lerini ve BP'leri oluştur (Docs/PHASE1_Task1_Setup.md) | Test haritasında yürü/koş/çömel/fener/kapı çalışıyor |
| 3 | Görev 1.2: `WBP_InteractionPrompt` (OnFocusChanged'e bağlı) | Kapıya bakınca "Open/Close" yazısı |
| 4 | Görev 1.3: Sakarya blockout (BSP/Modeling Tools, kutularla) | 7 alanın kaba hali yürünebilir |
| 5 | Görev 1.4: Kamera bileşeni + gizli sembol | Sembol yalnızca kamera açıkken görünüyor |
| 6 | Görev 1.5: Korku olayı + bölüm sonu | Kapı çarpması bir kez tetikleniyor, bölüm sonu ekranı |
| 7 | Ölçüm + düzeltme: `stat unit`, `stat memory`, git commit | 1080p Medium'da stabil kare süresi kaydedildi |

---

## 7. Riskler

- **Derleme belleği** (8 GB): en büyük risk. Önlemler yukarıda.
- **Motor sürümü:** `.uproject` `EngineAssociation: "5.6"` yazıyor. Senin kurduğun sürüm farklıysa dosyaya sağ tık → *Switch Unreal Engine version*. Kod 5.3+ API'lerine göre yazıldı.
- **Derlenmemiş kod:** ilk derlemede küçük hatalar çıkabilir; hata metnini gönder, düzeltirim.
- **Lisans:** Fab/Megascans içerikleri Unreal'da kullanım için ücretsiz; dışarıdan gelen her asset için lisansı `Docs/Licenses.md`'ye yazacağız (henüz yok).
