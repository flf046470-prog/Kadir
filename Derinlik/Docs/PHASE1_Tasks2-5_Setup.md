# PHASE 1 — Görev 1.2–1.5: Etkileşim yazısı, kamera + gizli sembol, korku olayı, bölüm sonu

Önce `PHASE1_Task1_Setup.md` bitmiş olmalı: karakter yürüyor, kapı açılıyor.

## Bu görevlerde yazılan kod
| Sınıf | Dosya | Amaç |
|---|---|---|
| `UDerinlikTextWidget` | `UI/DerinlikTextWidget.*` | Etkileşim yazısı ve bölüm başlığı için ortak widget (TextBlock adı: **MainText**) |
| `UDerinlikCamcorderOverlayWidget` | `UI/DerinlikCamcorderOverlayWidget.*` | Vizör arayüzü; **TimecodeText** varsa `REC 00:00:12` sayacı |
| `ADerinlikPlayerController` | `Player/DerinlikPlayerController.*` | Yazıyı gösterir, bölüm sonunda ekranı karartır, kontrolü kilitler, başlığı gösterir |
| `UDerinlikCamcorderComponent` | `Camcorder/DerinlikCamcorderComponent.*` | Kamerayı kaldır/indir, post-process "kamera görüntüsü", sembolleri göster, 2 sn bakınca etkinleştir |
| `ADerinlikHiddenSymbol` | `Camcorder/DerinlikHiddenSymbol.*` | Yalnızca kamerada görünen sembol; etkinleşince bağlı taşı kaydırır |
| `ADerinlikHorrorEventTrigger` | `Horror/DerinlikHorrorEventTrigger.*` | Kutudan girince sırayla çalışan, rastgele olmayan korku adımları (kapı kapat/kilitle, ışık söndür, ses) |
| `ADerinlikChapterEndPickup` | `Interaction/DerinlikChapterEndPickup.*` | Alınınca bölümü bitiren kaset |
| Doku | `SourceArt/Textures/T_FirstRecorderSigil.png` | Özgün İlk Kayıtçılar mührü (`Tools/Art/make_sigil.py` üretir) |

## Editör adımları

### A. Derle
`Tools\Windows\BuildEditor.bat` → "Build OK". Hata çıkarsa metni bana gönder.

### B. Kamera tuşu
1. `Content/Derinlik/Input` → Input Action **IA_Camcorder** (Digital/bool).
2. `IMC_Default` → IA_Camcorder: **Right Mouse Button** (veya Q).
3. `BP_DerinlikCharacter` → Class Defaults → Input → **Camcorder Action** = IA_Camcorder.

### C. Widget'lar (`Content/Derinlik/UI`)
Her biri: sağ tık → User Interface → Widget Blueprint → *All Classes* → parent'ı seç.
1. **WBP_InteractionPrompt** (parent `DerinlikTextWidget`): Canvas Panel → Text **MainText** (adı birebir), anchor ortada, Position Y = +60, font 18, renk açık gri, Justification Center. İstersen ortaya 4 px'lik bir nokta (crosshair) ekle.
2. **WBP_ChapterTitle** (parent `DerinlikTextWidget`): Text **MainText** tam ortada, font 48, harf aralığı geniş.
3. **WBP_CamcorderOverlay** (parent `DerinlikCamcorderOverlayWidget`): 4 köşe çizgisi (Image), sol üstte kırmızı nokta + Text **TimecodeText**, sağ üstte pil simgesi. Arka plan **şeffaf** kalmalı.

### D. Controller ve GameMode
1. `Content/Derinlik/Core` → Blueprint Class → parent `DerinlikPlayerController` → **BP_DerinlikPlayerController**: Prompt Widget Class = WBP_InteractionPrompt, Chapter Title Widget Class = WBP_ChapterTitle.
2. `BP_DerinlikGameMode` → Player Controller Class = BP_DerinlikPlayerController.

### E. Kamera görünümü (`BP_DerinlikCharacter`)
1. Components → **Camcorder** → Overlay Widget Class = WBP_CamcorderOverlay.
2. Components → **FirstPersonCamera** → Post Process (önerilen başlangıç): Film Grain Intensity 0.35 · Chromatic Aberration 0.5 · Vignette 0.7 · Color Grading › Global Saturation 0.75. *Post Process Blend Weight'i değiştirme*: kod bunu kamera kapalıyken 0, açıkken 1 yapar.

### F. Gizli sembol
1. `SourceArt/Textures/T_FirstRecorderSigil.png` dosyasını `Content/Derinlik/Environment/Sakarya/Decals` içine sürükle.
2. Material **M_Decal_Sigil**: Material Domain = *Deferred Decal*, Decal Blend Mode = *Translucent*. TextureSample(T_FirstRecorderSigil): **A → Opacity**, **RGB × (0.55, 0.85, 1.0) × 6 → Emissive Color**.
3. Place Actors → "Derinlik Hidden Symbol" → Koridor A'nın sonundaki duvara koy. **Kırmızı X oku duvara baksın**, kutu duvar yüzeyinin hemen önünde dursun. SymbolDecal → Decal Material = M_Decal_Sigil.
4. Duvarı kapatan taş levha (bir Cube yeterli) → **Mobility = Movable**. Sembolün Details panelinde **Linked Actors**'a bu levhayı ekle. Move Offset (0,0,-220) levhayı yere gömer.

### G. Korku olayı (Koridor B)
1. Place Actors → "Derinlik Horror Event Trigger" → Koridor B girişine koy, kutuyu koridor genişliğine ölçekle.
2. Işık olarak kullandığın ampulün **Mobility = Movable** olmalı (Lumen/ışık pişirme olmadan en basit yol).
3. Steps:
   | # | Delay | Action | Targets | Sound |
   |---|---|---|---|---|
   | 0 | 0 | Close Doors | BP_InteractiveDoor (arkadaki ahşap kapı) | — |
   | 1 | 0.4 | Lights Off | ampul (PointLight) | — |
   | 2 | 1.8 | Play Sound | koridorun uzak ucuna koyduğun boş bir actor | tek ayak sesi (lisanslı) |
4. Test: PIE sırasında F8 → trigger'ı seç → Details → **Fire Now**. `Reset Trigger` tekrar denemeye izin verir.

### H. Bölüm sonu
Place Actors → "Derinlik Chapter End Pickup" → kontrol odasındaki masaya koy. Mesh = SM_MiniDVTape (Meshy) veya geçici olarak küçük bir Cube (ölçek 0.1 × 0.07 × 0.02).

## Test kontrol listesi
| Test | Beklenen |
|---|---|
| Kapıya bak | Ekranda "Open" / "Close"; başka yere bakınca yazı kaybolur |
| Kilitli kapı | "Locked" |
| Sağ tık | Vizör arayüzü + REC sayacı, hafif yakınlaşma, gren ve vinyet |
| Kamera kapalıyken duvara bak | Sembol **görünmez** |
| Kamera açıkken | Sembol parlıyor; 2 sn ortada tutunca taş levha 4 sn'de yere iner |
| Sembolden 2 sn dolmadan uzaklaş | Sayaç sıfırlanır, levha inmez |
| Koridor B'ye gir | Kapı kapanır → 0.4 sn sonra ışık söner → 1.8 sn sonra uzakta ayak sesi; **bir kez** |
| Tekrar aynı kutuya gir | Hiçbir şey olmaz |
| Kasete bak + E | "Take tape" → ekran 2.5 sn'de kararır, kontrol kilitlenir, "KAPI 01 — SAKARYA" görünür |
| Output Log | `LogDerinlik` uyarısı yok; `HorrorEvent ... fired (3 steps)` satırı var |

**Başarı kriteri:** Başlangıçtan kasete kadar 3–5 dakikalık akış kesintisiz oynanıyor. `stat unit` sonuçlarını bana gönder.
