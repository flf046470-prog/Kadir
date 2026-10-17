# PC'de tam erişim: Claude'u bilgisayarında Unreal'a bağlama

Bulut oturumu senin bilgisayarına bağlanamaz. Claude'un derleme yapması, editörü yönetmesi ve Meshy'yi çalıştırması için Claude Code'u **kendi bilgisayarında** çalıştırırsın. O oturum senin izin verdiğin ölçüde dosyalarına, terminaline ve açık Unreal Editor'a erişir.

## 1. Bir kez kurulum (Windows)
1. **Git for Windows** ve **Git LFS** kurulu olsun (https://git-scm.com/downloads/win).
2. PowerShell'i aç (CMD değil) ve Claude Code'u kur:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```
   Kaynak: https://code.claude.com/docs/en/setup
3. Projeyi indir:
   ```powershell
   git lfs install
   git clone https://github.com/flf046470-prog/Kadir.git
   cd Kadir
   git checkout claude/amazing-allen-jnpr5e
   cd Derinlik
   ```

## 2. Oturumu başlat
`Derinlik` klasöründe:
- **Bilgisayarın başındaysan:** `claude`
- **Telefondan veya Claude uygulamasından yönetmek istiyorsan:** `claude remote-control` (oturum Claude Code uygulamasında görünür).

İlk mesaj olarak şunu yazabilirsin: *"Docs/PC_Full_Access.md ve Docs/PHASE1_Tasks2-5_Setup.md'yi oku, projeyi derle, editöre bağlan ve Phase 1 kurulumunu yap."*

**İzinler:** Claude her komuttan önce izin ister. Dosya düzenlemelerini otomatik kabul etmek için oturumda **Shift+Tab** ile "accept edits" moduna geçebilirsin. Tüm izinleri kapatan modu önermiyorum; silme ve yayınlama gibi işlemler senin onayınla olmalı.

## 3. Claude'un Unreal'a bağlanması
Proje, editörün yalnızca bu bilgisayardan (127.0.0.1) Python komutu kabul etmesini sağlayacak şekilde ayarlı (`Config/DefaultEngine.ini` → `bRemoteExecution=True`).

1. `Tools\Windows\BuildEditor.bat` → derle (Claude da çalıştırabilir).
2. `Derinlik.uproject` ile editörü aç ve tamamen yüklenmesini bekle.
3. Bağlantı testi:
   ```powershell
   python Tools/Unreal/ue_remote.py --ping
   ```
   Beklenen: `[Info] Connected to 5.x.x-...`
4. Bundan sonra Claude editörde iş yapabilir, örneğin:
   ```powershell
   python Tools/Unreal/ue_remote.py --file Tools/Unreal/import_meshy_assets.py
   python Tools/Unreal/ue_remote.py --code "import unreal; print(unreal.EditorLevelLibrary.get_all_level_actors())"
   ```

**Bağlantı yoksa:**
- Edit → Project Settings → Plugins → Python → **Enable Remote Execution** açık mı?
- Windows Güvenlik Duvarı UnrealEditor için izin istediyse "Özel ağ"a izin ver.
- Motor varsayılan klasörde değilse: `$env:UE_ROOT = "D:\UE_5.x"`.

## 4. Bu kurulumla Claude neler yapabilir, neler yapamaz?
| Yapabilir | Yapamaz / senin onayın gerekir |
|---|---|
| C++ derlemek, hataları okuyup düzeltmek | Editör penceresini görmek; ekran görüntüsünü sen göndermelisin |
| Editörde Python ile asset içe aktarmak, actor yerleştirmek, ayar yapmak | Oyunu oynayıp hissini değerlendirmek; PIE testini sen yaparsın |
| Meshy'den model üretmek (kendi anahtarınla) | Ücretli işlemleri senin onayın olmadan başlatmak |
| Git commit ve push (LFS dosyaları dahil) | Asset silmek veya yayınlamak (izin ister) |

## 5. 8 GB RAM uyarısı
Editör, derleme ve Claude Code'un aynı anda açık olması belleği zorlar. Derleme sırasında tarayıcıyı kapat. Gerekirse derlemeyi editör kapalıyken yap.
