# DERİNLİK II — 78° Güney

İlk oyunun devamı. Hikâye ve bölüm planı: `DESIGN.md`.

**Durum:** Bölüm 1 (İSTASYON) oynanabilir, baştan sona test edildi. Bölüm 2–4 (KUYU, GÖL, KAYNAK) yazılmadı.

## Nasıl çalışır
Ayrı bir motor yok. `make.py` ilk oyunun `DerinlikWeb/game.html` çekirdeğini alır ve şunları değiştirir:
- bölüm listesi (yeni bölümler `src/chapters.js` içinde),
- başlık ekranı,
- kayıt anahtarı (`derinlik2.save.v1`).

Efekt modülleri (`DerinlikWeb/src/fx-*.js`), modeller ve dokular ortak. Bu yüzden bir düzeltme iki oyuna birden gider. İlk oyun bir sona ulaştıysa (`derinlik.legacy.v1`), telsizde konuşan kişi ve bitiş ekranı o sona göre değişir. İkinci oyun ilk oyunun kayıtlarına yazmaz.

## Bölüm 1 · İSTASYON (Kerguelen-78, kurgusal istasyon)
- Varış kulübesi: nöbet defteri.
- Kar fırtınasında halat boyunca yürüyüş. Dışarıda 40 saniyeden uzun kalırsan bayılıp kulübeye dönersin.
- Fırtınada yalnızca kamerada görünen bir figür.
- Jeneratör salonu: duvara dönük donmuş sondaj şefi Hartmann ve tek yakıt bidonu.
- **Karar:** yakıtı jeneratöre ver (ışık ve telsiz açılır, önceki sona göre biri konuşur) ya da asansör motoruna ver (karanlık, hızlı iniş).
- Asansörle iniş → bölüm sonu.

## Derlemek ve test etmek
```bash
python3 DerinlikII/make.py --offline                  # -> DerinlikII/dist/index.html (internetsiz, tek dosya)
node DerinlikII/test_slice.mjs DerinlikII/dist/index.html generator tanik   # ya da: lift ""
```
Test, Playwright'ı `DerinlikSteam/tools` içinden kullanır. O klasöre kopyalayıp çalıştırın ya da `NODE_PATH` verin. Tarayıcı yolu `CHROME_PATH` ile verilir.
