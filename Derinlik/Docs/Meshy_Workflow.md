# Meshy.ai → Unreal iş akışı

## 1. Modelleri üret (senin bilgisayarında)
API anahtarını **asla** dosyaya veya git'e yazma; yalnızca ortam değişkeni olarak ver.

```powershell
cd Derinlik
$env:MESHY_API_KEY = "msy_..."                                   # yalnızca bu terminal penceresi için
python Tools/Meshy/meshy_generate.py --dry-run                   # neyin gönderileceğini gösterir, kredi harcamaz
python Tools/Meshy/meshy_generate.py --only SM_Flashlight        # tek model (önce bununla dene)
python Tools/Meshy/meshy_generate.py --min-balance 50            # hepsi; bakiye 50'nin altına inerse durur
```

- Liste: `Tools/Meshy/assets_phase1.json` (kamera, el feneri, bodrum kapısı, raf, MiniDV kaset, taş konsol). Yeni model eklemek için bu dosyaya bir satır ekle.
- Her model = 1 preview + 1 refine görevi. Harcanan kredi her çalıştırmanın sonunda yazılır.
- Çıktı: `SourceArt/Meshy/<Ad>/` (model.fbx, model.glb, textures/, thumbnail.png, task.json). Bu klasör Git LFS ile takip edilir.
- Yarıda kesilirse aynı komutu tekrar çalıştır: bitenleri atlar, süren görevi kaldığı yerden bekler.
- `--preview-only`: dokusuz, daha ucuz bir şekil denemesi. `--force`: modeli yeniden üretir.

## 2. Ana materyali bir kez oluştur
Content Browser → `Content/Derinlik/Materials` → Material → **M_MeshyPBR**. İçine 4 adet *TextureSampleParameter2D* ekle:

| Parametre adı | Sampler Type | Bağlantı |
|---|---|---|
| `BaseColor` | Color | RGB → Base Color |
| `Normal` | Normal | RGB → Normal |
| `Roughness` | Masks | R → Roughness |
| `Metallic` | Masks | R → Metallic |

Kaydet. (Her parametreye geçici olarak uygun bir doku seçmen gerekirse motorun varsayılan dokularını kullanabilirsin.)

## 3. Unreal'a aktar
Editör → **Tools → Execute Python Script…** → `Tools/Unreal/import_meshy_assets.py`.
Sonuç: `Content/Derinlik/Environment/Sakarya/Props/<Ad>/` altında mesh, `Textures/` ve `MI_<Ad>` oluşur. Output Log'da `[Meshy] imported N asset(s)` satırı görünür.

## 4. Kontrol listesi
- **Ölçek:** Modeli varsayılan Mannequin'in (≈180 cm) yanına koy. 100 kat büyük/küçükse FBX import ölçeğini (Uniform Scale) 100 veya 0.01 yapıp yeniden içe aktar.
- **Normal haritası:** Işık ters görünüyorsa (çıkıntılar oyuk gibi) doku ayarlarında **Flip Green Channel**'ı işaretle.
- **Kapı:** Menteşe kenarı `BP_InteractiveDoor`'daki Hinge noktasına gelecek şekilde DoorMesh konumunu ayarla.
- **Performans:** Dokular en fazla 2048 px. 30k üçgenden büyük modellerde (ör. taş konsol) Nanite'ı aç.

## Lisans
Meshy'nin **ücretli** planlarında üretilen modeller kullanıcıya aittir. **Ücretsiz** planda üretilenler CC BY 4.0 lisanslıdır; ticari kullanım serbesttir ama jenerikte "Model created with Meshy" atfı gerekir. Kaynak: https://help.meshy.ai/en/articles/9992001-can-i-use-meshy-assets-commercially-license-copyright-explained. Hangi planda üretildiğini `Docs/Licenses.md` dosyasına yaz.
