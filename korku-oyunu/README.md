# Karabasan

Bilgisayarda tarayıcıda oynanan, birinci şahıs bir korku oyunu. Tek dosya, kurulum yok.

## Nasıl oynanır

1. `index.html` dosyasını çift tıklayıp Chrome, Edge ya da Firefox ile aç.
2. **Başla** düğmesine bas, sonra ekrana tıklayıp fareyi kilitle.
3. Evin içine saklanmış 5 muskayı topla. Beşi de toplanınca çıkış kapısı açılır. Kapıya ulaşırsan kazanırsın.
4. Karabasan sana dokunursa oyun biter.

Kulaklıkla oyna: kalp atışın, Karabasan'ın nefesi ve muskaların çınlaması yön bulmana yardım eder.

## Tuşlar

| Tuş | İş |
| --- | --- |
| W A S D | Yürü |
| Fare | Etrafına bak |
| ← → (ya da Q / E) | Fare olmadan dön |
| Shift | Koş (nefes biter) |
| F | Feneri aç / kapat |
| M (basılı tut) | Gördüğün yerlerin haritası |
| Esc ya da P | Duraklat |

## Kurallar

- Koşarsan Karabasan seni uzaktan duyar. Yavaş yürürsen ancak yakındayken duyar.
- Fenerin açıkken seni koridorun ucundan görür. Fener kapalıyken sadece çok yakındayken fark eder.
- Fenerin pili azalır. Yerdeki pilleri topla.
- Her muskadan sonra Karabasan biraz daha hızlanır.
- Her oyunda ev yeniden kurulur; harita hiç aynı olmaz.

## Teknik

Saf JavaScript ile yazılmış bir ışın izleme (raycasting) motoru, `<canvas>` üzerinde düşük çözünürlükte çizilir. Dokular, canavar ve bütün sesler oyun açılırken kodla üretilir; dışarıdan hiçbir dosya yüklenmez (yalnızca menü yazı tipleri Google Fonts'tan gelir, internet yoksa sistem yazı tipi kullanılır). En iyi süren tarayıcının yerel deposunda saklanır.
