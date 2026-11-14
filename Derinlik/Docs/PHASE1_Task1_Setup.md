# PHASE 1 — Görev 1.1: Karakter, el feneri, etkileşim, kapı

## Bu görevde yazılan kod
| Dosya | Amaç |
|---|---|
| `Source/Derinlik/Public|Private/Player/DerinlikCharacter.*` | Yürüme (190), koşma (380), çömelme (toggle), hafif baş sallanması (`HeadBobScale` = 0 ile kapanır), el feneri, 2.2 m etkileşim izi, `OnFocusChanged` olayı |
| `Source/Derinlik/Public/Interaction/DerinlikInteractable.h` | Tek etkileşim arayüzü: `CanInteract`, `GetInteractionPrompt`, `Interact` (Blueprint'te de uygulanabilir) |
| `Source/Derinlik/Public|Private/Interaction/DerinlikDoor.*` | Oyuncudan uzağa açılan menteşeli kapı, kilit, `SetOpen` (korku olayları için), `OnDoorStateChanged` |
| `Source/Derinlik/Private/DerinlikGameMode.cpp` | Varsayılan oyun modu |

## Adımlar (Windows)

1. `git lfs install` (bir kez), depoyu klonla.
2. `Derinlik/Derinlik.uproject` → sağ tık → **Generate Visual Studio project files**. (Sürüm farklıysa önce *Switch Unreal Engine version*.)
3. `Derinlik.sln`'yi aç → yapılandırma **Development Editor / Win64** → Build. Tarayıcıyı kapat.
   Alternatif: `.uproject`'e çift tık → "modülleri yeniden derle?" → Yes.
4. Editör açılınca Content Browser'da `Content/Derinlik/Input` oluştur:
   - Input Action'lar: `IA_Move` (Value Type: **Axis2D**), `IA_Look` (**Axis2D**), `IA_Sprint`, `IA_Crouch`, `IA_Flashlight`, `IA_Interact` (Digital/bool).
   - `IMC_Default` (Input Mapping Context):
     - IA_Move: **W** (Modifier: Swizzle Input Axis Values), **S** (Swizzle + Negate), **D**, **A** (Negate)
     - IA_Look: **Mouse XY 2D-Axis** (Modifier: Negate → yalnızca Y işaretli)
     - IA_Sprint: Left Shift · IA_Crouch: Left Ctrl (veya C) · IA_Flashlight: F · IA_Interact: E
5. `Content/Derinlik/Core`:
   - **Blueprint Class** → parent `DerinlikCharacter` → `BP_DerinlikCharacter`. Class Defaults → Input bölümünde 7 asset'i ata.
   - Blueprint Class → parent `DerinlikGameMode` → `BP_DerinlikGameMode`, Default Pawn Class = `BP_DerinlikCharacter`.
   - Project Settings → Maps & Modes → Default GameMode = `BP_DerinlikGameMode`.
6. `Content/Derinlik/Interaction`: parent `DerinlikDoor` → `BP_InteractiveDoor`. `DoorMesh`'e bir kapı meshi ver (geçici: Cube, ölçek X 0.05 · Y 0.9 · Z 2.1, Location Y = 45 ki menteşe kenarda kalsın).
7. `Content/Derinlik/Maps/L_Test_Character` oluştur (File → New Level → Basic): zemin, birkaç duvar, bir `BP_InteractiveDoor`, Directional Light'ı çok kıs (fener testi için).

## Test kontrol listesi
| Test | Beklenen |
|---|---|
| WASD | Yavaş, kontrollü yürüme |
| Shift basılı + ileri | Hız artar; çömelikken koşmaz |
| Ctrl | Kamera alçalır, alçak bölmeden geçilir; tekrar basınca kalkar |
| F | El feneri açılır/kapanır, gölge düşürür |
| Kapıya bak + E | Kapı oyuncudan uzağa yavaşça açılır; tekrar E kapanır |
| Kapı Details → `bLocked` = true | E ile açılmaz |
| `HeadBobScale` = 0 | Kamera sallanması tamamen kaybolur |
| Output Log | `LogDerinlik` uyarısı yok (varsa: mapping context atanmamış) |
| `stat unit` | Frame/Game/Draw/GPU değerlerini not edip bana gönder |

**Başarı kriteri:** Tüm satırlar çalışıyor, derleme uyarısız. Hata çıkarsa Output Log / Visual Studio Error List metnini kopyalayıp gönder.
