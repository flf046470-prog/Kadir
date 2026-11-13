"""App Store screenshots from raw in-engine stills (tools/capture_stills.cjs).

    python3 tools/make_store_images.py <stills_dir> <out_dir>

For each still a caption band is laid over the left of the frame (a dark gradient so the
game image stays readable) and two sizes are written:
  <out_dir>/6.9/<nn>.png  2868×1320  (iPhone 6.9" landscape — the required set)
  <out_dir>/6.5/<nn>.png  2778×1284  (iPhone 6.5" landscape)
Captions are Turkish (primary locale); English set in <out_dir>/en/... with --en.
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
SIZES = {"6.9": (2868, 1320), "6.5": (2778, 1284)}

CAPTIONS = {
    "g2_ramp_door": (("HELIKON-14", "İstasyon 03:17'de sustu.", "İçeri gir, izleri takip et."),
                     ("HELIKON-14", "The station went silent at 03:17.", "Step inside and follow the trail.")),
    "g3_generator": (("ENERJİYİ GERİ GETİR", "Jeneratörü çalıştır,", "istasyonu yeniden canlandır."),
                     ("RESTORE THE POWER", "Start the generator and", "bring the station back to life.")),
    "g5_frequency": (("KAYIP FREKANS", "Gelecekten gelen yayını", "çözümle."),
                     ("THE LOST FREQUENCY", "Decode a broadcast", "sent from tomorrow.")),
    "g6_cave_torch": (("BUZUN ALTINDA", "Fenerini yak. Var olmaması", "gereken bir mağaraya in."),
                      ("BENEATH THE ICE", "Light your torch. Descend into", "a cave that shouldn't exist.")),
    "g7_crystals": (("KRİSTALLERİ UYANDIR", "Doğru sırayı bul,", "HELIKON'un kapısını aç."),
                    ("WAKE THE CRYSTALS", "Find the right order and", "open the way to HELIKON.")),
    "g8_selin": (("DR. SELİN", "Ekipten geriye kalan tek ses.", "Ona güvenebilir misin?"),
                 ("DR. SELİN", "The last voice of the team.", "Can you trust her?")),
    "g9_wide": (("ÇEVRİMDIŞI · REKLAMSIZ", "Tam kayıt, dokunmatik analog", "kontroller ve oyun kumandası."),
                ("OFFLINE · NO ADS", "Full saves, analog touch", "controls and controller support.")),
    "h1_hall_stars": (("TAŞ SALON", "İnsanlıktan eski bir yapı.", "Tavanındaki yıldızlar bir harita."),
                      ("THE STONE HALL", "Older than humankind.", "The stars on its ceiling are a map.")),
    "c1_city_bridge": (("BUZUN ALTINDAKİ ŞEHİR", "Dört kilometre buzun altında,", "bir gölün ortasında ışıklar yanıyor."),
                       ("THE CITY UNDER THE ICE", "Four kilometres down, lights", "burn in the middle of a lake.")),
    "gr2_sync": (("İKİ ŞEBEKEYİ EŞLE", "Senkronoskobu izle, doğru anda", "şalteri kapat. Kış geliyor."),
                 ("COUPLE THE TWO GRIDS", "Watch the synchroscope, close the", "breaker in phase. Winter is coming.")),
    "k1_camp_drone": (("SİLAHSIZSIN", "Termal dronlar sıcağı görür.", "Soğuk kal, gölgede yürü."),
                      ("YOU ARE UNARMED", "Thermal drones see warmth.", "Stay cold. Stay in cover.")),
    "t1_tower_clock": (("03:17", "Yedi bölüm, üç son.", "Saat geldiğinde ne yapacaksın?"),
                       ("03:17", "Seven chapters, three endings.", "What will you do when the clock strikes?")),
}

def font(weight, size):
    return ImageFont.truetype(FONT.format(weight), size)


def compose(src, caption, size):
    W, H = size
    im = Image.open(src).convert("RGB")
    # cover-fit the still into the target size
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((l, t, l + W, t + H))
    # left gradient for legibility
    grad = Image.new("L", (W, 1))
    for x in range(W):
        u = x / (W * 0.52)
        grad.putpixel((x, 0), int(205 * max(0.0, 1 - u) ** 1.6))
    shade = Image.new("RGB", (W, H), (3, 12, 20))
    im = Image.composite(shade, im, grad.resize((W, H)))
    d = ImageDraw.Draw(im)
    k = H / 1320
    x = int(150 * k)
    head, l1, l2 = caption
    fh, fb = font("Bold", int(96 * k)), font("Regular", int(62 * k))
    y = int(H * 0.36)
    d.rectangle((x, y - int(46 * k), x + int(110 * k), y - int(36 * k)), fill=(255, 176, 120))
    d.text((x, y), head, font=fh, fill=(236, 250, 255))
    y += int(140 * k)
    for line in (l1, l2):
        d.text((x, y), line, font=fb, fill=(196, 226, 236))
        y += int(84 * k)
    return im


def main():
    stills, out = sys.argv[1], sys.argv[2]
    lang = 1 if "--en" in sys.argv else 0
    files = sorted(glob.glob(os.path.join(stills, "*.png")))
    if not files:
        raise SystemExit("no stills in " + stills)
    for i, f in enumerate(files, 1):
        shot = os.path.basename(f)[3:-4]
        cap = CAPTIONS[shot][lang]
        for name, size in SIZES.items():
            d = os.path.join(out, ("en/" if lang else "") + name)
            os.makedirs(d, exist_ok=True)
            compose(f, cap, size).save(os.path.join(d, "%02d.png" % i), optimize=True)
        print("ok", i, shot)


if __name__ == "__main__":
    main()
