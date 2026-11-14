# DERİNLİK II — 78° GÜNEY (tasarım belgesi, taslak 1)

İlk oyunun bıraktığı yerden devam eden birinci şahıs psikolojik korku oyunu. Motor, efekt modülleri (`fx-*`), ses sentezi, video kamera, kanıt arşivi, VR ve mağaza paketleri ilk oyundan gelir; bu belge yalnızca **hikâyeyi, bölümleri ve yeni mekanikleri** tanımlar.

## Kanca (ilk oyunun sonu)
Her sondan sonra karanlık kamera ekranında **KAYIT 00 — 03:17** oynar:
> Dört merkez deneyin yapıldığı yerler değildi. Dört merkez, bir şeyi içeride tutmak için kurulmuştu. Son sinyal: 78° Güney. ANTARKTİKA — BAĞLANTI KESİLDİ.

Ardından lensin arkasından bir ses: *“Kapıları kapattığını mı sandın?”*

**Öncül:** Sakarya, Nevşehir, SIFIR-17 ve PALİMPSEST bir ağın dört **mührüydü**. Ağın beşinci noktası, mühürlerin kilitlediği şeyin kendisi: buzun 3,7 km altında, kimsenin kurmadığı bir yapı. İkinci Ses oradan geliyor. 2029 kışında (güney yazı biter, kutup gecesi başlarken) Ekin, KAYIT 00'ı gönderen terk edilmiş sondaj istasyonuna gider.

## İlk oyundan aktarım (`derinlik.legacy.v1`)
İlk oyun bir sona ulaşınca son ve kararlar tarayıcıya kaydedilir (`{ ending, choices, time }`; ilk oyun 5b4dfd3 ile yazıyor, bir sonla test edildi). İkinci oyun açılışta bunu okur; kayıt yoksa oyuncuya üç soruyla “önceki hikâye” seçtirilir (Deniz yaşıyor mu, Élise'in adı kimde, kapıyı kim kapattı).

| Önceki son | DERİNLİK II'de dünya | Başlangıç farkı |
|---|---|---|
| Eve Dönüş | Élise hayatta, Camille geçidin içinde | Élise'in çizimleri ipucu olur; Camille'in sesi telsizde |
| Geri Gelen | Élise'in sesiyle konuşan şey dünyada | “Élise” bölüm 3'te düşmanın biçimlerinden biri |
| İki Tanık | Mühürler sağlam, Deniz yaşıyor | **Deniz telsizde ortak** (yüzeyden yönlendirir) |
| Unutulan | Kimse Ekin'i hatırlamıyor | Kanıt arşivi boş başlar; istasyon kayıtlarında Ekin'in adı yok |
| Yeni Dünya | Dördüncü mühür ekranlarda kırık | İkinci Ses her ekranda; kamera vizörü daha çok “sızıntı” gösterir |
| Kanıt | SIFIR-17 askerî yasak bölge, Ekin ünlü | Bir hükümet ekibi istasyona daha önce girmiş (cesetler, notlar) |
| Son Bekçi | Ekin geçidin içinde | Oyun **geçidin öbür ucunda**, buzun altında başlar; bölümler ters sırada oynanır |

## Bölümler (dört bölüm, ilk oyunla aynı ölçek)
1. **İSTASYON** · *Kerguelen-78 sondaj istasyonu (kurgusal), 78° G, kutup gecesi.* Kar fırtınası, jeneratör, donmuş mürettebatın son günlükleri. Yüzey binaları arasında halat boyunca ilerleme; dışarıda kalınca vücut ısısı düşer. **Karar:** son yakıtı jeneratöre (istasyon ışıkları, telsiz açık) ya da sonda asansörüne (inişi hızlandırır, istasyon karanlığa gömülür) ver.
2. **KUYU** · *3,7 km'lik sondaj kuyusu ve buz tünelleri.* Mavi buz, 1977'den kalma sondaj ekibi buzun içinde donmuş. Buzdaki **yansımalar** başka şeyler gösterir: düşman yalnızca yansımalarda ve kamerada görünür (“Yansıma”). **Karar:** buza gömülü ekip şefinin kaydını kurtar ya da onu çözmeye çalış (çözülen şey o değildir).
3. **GÖL** · *Buzaltı gölünün kıyısı, beşinci yapı.* Dört mührün malzemeleri burada tek yapıda: Kapadokya tüfü, Kola betonu, Paris kireçtaşı, Sakarya tuğlası; hepsi yüz binlerce yıllık. Önceki sona göre biçim değiştiren düşman. Ses suyun altında farklı yayılır; ses bulmacası. **Karar:** önceki oyundaki kişiyi (Deniz / Élise / Camille, sona göre) geri gönder ya da yanında tut.
4. **KAYNAK** · *Yapının kalbi.* İkinci Ses'in kendisi: “hiç doğmamış olanlar”. Kamera burada tersine çalışır; çekilen her şey silinir. **Son kararlar:** ağı yeniden mühürle (bir bekçi gerekir), kaynağı kaydet ve dışarı taşı, ya da kaynağın içine gir.

Sonlar: 6 son, hepsi kesin; önceki oyunun sonuyla birlikte 7 × 6 kombinasyon değil, önceki son yalnızca konuşmaları ve bir son varyantını değiştirir. Üçüncü oyun kancası yazılmaz (seri burada kapanabilir).

## Yeni mekanikler
- **Soğuk:** vücut ısısı göstergesi yok; görüntü kenardan buğulanır, el titrer, fener pili soğukta hızla biter. Isıtıcı lambaların yanında ısınılır. VR'da elleri koltuk altına almak ısıtır.
- **Yansımalar:** cilalı buz ve su yüzeyleri kamera gibi davranır; `fx-lighting`'deki ortam probu yerine düzlemsel yansıma (yalnızca yansıma yüzeyleri, *high*/*medium*).
- **Pil:** kamera ve fener aynı pil grubunu paylaşır; kayıt mı ışık mı.
- **Telsiz:** ortak karakterle (sona göre Deniz, Camille ya da kimse) gerçek zamanlı konuşma satırları; seçmeli cevaplar.
- **Buzda nefes:** fener ışığında nefes buharı (fx-atmos'taki hava ışığı bunu görünür kılar).

## Teknik plan
- **Klasör:** `DerinlikII/` → `game.html` (ilk oyunun çekirdeğinden türetilir), `src/` (yalnızca yeni modüller), `build.py` ilk oyundaki `DerinlikWeb/src/fx-*.js`'i de içeri alır; böylece ortak efektlerdeki düzeltmeler iki oyuna birden gider.
- **Kayıt anahtarları:** `derinlik2.save.v1`, `derinlik2.quality`; ilk oyunun anahtarlarına yazmaz, yalnızca `derinlik.legacy.v1`'i okur.
- **Varlıklar:** Blender ile yeni dokular (mavi buz, sıkışmış kar, donmuş metal, buzaltı kayası) ve objeler (sondaj kulesi, kızak, konteyner modüller, ısıtıcı); `tools/make_props.py` ve `bake_textures.py` aynı yöntemle.
- **Test:** `gallery.mjs` ve sonlar testi aynı API ile (`window.__derinlik2`).
- **Mağaza:** Steam'de ayrı uygulama (ilk oyun DLC değil); Meta'da ayrı uygulama. İki oyunda da ayrı App ID gerekir (kullanıcının işi).

## Sıradaki adım
Bölüm 1 (İSTASYON) için oynanabilir dikey kesit: istasyonun iki binası, halat, fırtına, jeneratör kararı ve aktarım okuması. Onaydan sonra.
