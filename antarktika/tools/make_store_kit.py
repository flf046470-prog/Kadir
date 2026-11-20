"""Store art kit for Steam and the Meta Horizon Store from the Cycles key art (render_keyart.py).

    python3 tools/make_store_kit.py <keyart_dir> <out_dir>

Sizes and rules are the stores' own (read 2026-11-13):
  Steam   partner.steamgames.com/doc/store/assets/standard + /libraryassets + /rules
          capsules carry artwork + the game's logo only (no other text); library hero has no text;
          library logo is the logotype alone on transparency, 1280 px wide.
  Meta    developers.meta.com/horizon/resources/asset-guidelines
          24-bit PNG; title must be legible, inside the safe area, never in the corners; no badges,
          taglines or other text; icon is solid, square-cornered, 512 px; logo is a 32-bit PNG.
Output
  <out>/steam/  header_capsule_920x430.png small_capsule_462x174.png main_capsule_1232x706.png
                vertical_capsule_748x896.png page_background_1438x810.png library_capsule_600x900.png
                library_header_920x430.png library_hero_3840x1240.png library_logo_1280.png
  <out>/meta/   hero_cover_3000x900.png cover_landscape_2560x1440.png cover_square_1440x1440.png
                cover_portrait_1008x1440.png mini_landscape_1080x360.png logo_transparent.png
                icon_512.png spatial_icon_background_180.png spatial_icon_foreground_180.png
                trailer_cover_2560x1440.png preview_360_equirect_7680x3840.jpg (if the pano exists)
  <out>/logo/   logo_light.png (transparent master)
  quest/icons/  icon-192.png icon-512.png icon-512-maskable.png (PWA icons, from the app icon)
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
ICE, WARM = (236, 250, 255), (255, 196, 146)


def font(weight, size):
    return ImageFont.truetype(FONT.format(weight), max(8, int(size)))


def logo(width, stacked=True, shadow=True):
    """The logotype: ANTARKTIKA (Black) over W H I T E O U T (Light, letter-spaced), transparent."""
    f1 = font("Black", width * 0.172)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    w1 = probe.textlength("ANTARKTIKA", font=f1)
    f1 = font("Black", width * 0.172 * (width * 0.96) / w1)
    b1 = probe.textbbox((0, 0), "ANTARKTIKA", font=f1)
    h1 = b1[3] - b1[1]
    word = "WHITEOUT"
    f2 = font("Light", h1 * 0.46)
    cw = [probe.textlength(c, font=f2) for c in word]
    gap = (width * 0.96 - sum(cw)) / (len(word) - 1)
    b2 = probe.textbbox((0, 0), word, font=f2)
    h2 = b2[3] - b2[1]
    bar = max(2, int(h1 * 0.05))
    H = int(h1 + h2 + h1 * 0.42 + bar + h1 * 0.5)
    im = Image.new("RGBA", (int(width), H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y = width * 0.02, h1 * 0.2
    d.text((x0 - b1[0], y - b1[1]), "ANTARKTIKA", font=f1, fill=ICE + (255,))
    y += h1 + h1 * 0.17
    d.rectangle([x0, y, x0 + width * 0.96, y + bar], fill=WARM + (255,))
    y += bar + h1 * 0.17
    x = x0
    for c, w in zip(word, cw):
        d.text((x, y - b2[1]), c, font=f2, fill=WARM + (255,))
        x += w + gap
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(im.getchannel("A").filter(ImageFilter.GaussianBlur(max(2, width * 0.012))))
        base = Image.new("RGBA", im.size, (0, 6, 12, 0))
        base.putalpha(sh.getchannel("A").point(lambda v: int(v * 0.85)))
        im = Image.alpha_composite(base, im)
    return im


def cover(src, size, focus=(0.5, 0.5), zoom=1.0):
    """Cover-fit crop around a focal point (0..1 of the source)."""
    W, H = size
    s = max(W / src.width, H / src.height) * zoom
    im = src.resize((max(W, round(src.width * s)), max(H, round(src.height * s))), Image.LANCZOS)
    l = min(max(0, round(im.width * focus[0] - W / 2)), im.width - W)
    t = min(max(0, round(im.height * focus[1] - H / 2)), im.height - H)
    return im.crop((l, t, l + W, t + H))


def shade(im, box, strength=0.6):
    """Soft dark vignette behind the logo box so the title keeps its contrast on any artwork."""
    W, H = im.size
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = box
    pad = (y1 - y0) * 0.5
    d.ellipse([x0 - pad * 2, y0 - pad, x1 + pad * 2, y1 + pad], fill=int(255 * strength))
    m = m.filter(ImageFilter.GaussianBlur((y1 - y0) * 0.55))
    return Image.composite(Image.new("RGB", (W, H), (2, 8, 14)), im, m)


def compose(src, size, focus, logo_w, logo_xy, zoom=1.0, shade_k=0.6):
    """logo_w and logo_xy are fractions of the canvas; logo_xy is the logo's centre."""
    im = cover(src, size, focus, zoom).convert("RGB")
    if logo_w:
        lg = logo(size[0] * logo_w)
        x = int(size[0] * logo_xy[0] - lg.width / 2)
        y = int(size[1] * logo_xy[1] - lg.height / 2)
        im = shade(im, (x, y, x + lg.width, y + lg.height), shade_k)
        im.paste(lg, (x, y), lg)
    return im


def save(im, path, fmt=None, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, fmt, **kw)
    print("  %-46s %dx%d %s" % (os.path.basename(path), im.width, im.height, im.mode))


def main():
    src_dir, out = sys.argv[1], sys.argv[2]
    ld = lambda n: Image.open(os.path.join(src_dir, n)).convert("RGB")   # noqa: E731
    station, portrait, city = ld("keyart_station.png"), ld("keyart_portrait.png"), ld("keyart_city.png")

    print("steam")
    S = os.path.join(out, "steam")
    save(compose(station, (920, 430), (0.52, 0.50), 0.50, (0.29, 0.30)), S + "/header_capsule_920x430.png")
    save(compose(station, (462, 174), (0.58, 0.56), 0.86, (0.50, 0.50), zoom=1.15, shade_k=0.8), S + "/small_capsule_462x174.png")
    save(compose(station, (1232, 706), (0.50, 0.50), 0.46, (0.28, 0.25)), S + "/main_capsule_1232x706.png")
    save(compose(portrait, (748, 896), (0.50, 0.62), 0.80, (0.50, 0.17)), S + "/vertical_capsule_748x896.png")
    bg = cover(city, (1438, 810), (0.5, 0.45)).filter(ImageFilter.GaussianBlur(3))
    save(Image.blend(bg, Image.new("RGB", bg.size, (4, 12, 18)), 0.45), S + "/page_background_1438x810.png")
    save(compose(portrait, (600, 900), (0.50, 0.60), 0.82, (0.50, 0.15)), S + "/library_capsule_600x900.png")
    save(compose(station, (920, 430), (0.52, 0.50), 0.50, (0.29, 0.30)), S + "/library_header_920x430.png")
    save(cover(station, (3840, 1240), (0.5, 0.68)), S + "/library_hero_3840x1240.png")
    save(logo(1280, shadow=False), S + "/library_logo_1280.png")

    print("meta")
    M = os.path.join(out, "meta")
    save(compose(station, (3000, 900), (0.5, 0.60), 0.28, (0.50, 0.16), shade_k=0.45), M + "/hero_cover_3000x900.png")
    save(compose(station, (2560, 1440), (0.5, 0.5), 0.44, (0.50, 0.24)), M + "/cover_landscape_2560x1440.png")
    save(compose(station, (1440, 1440), (0.50, 0.55), 0.70, (0.50, 0.20), zoom=1.0), M + "/cover_square_1440x1440.png")
    save(compose(station, (1008, 1440), (0.50, 0.55), 0.80, (0.50, 0.17)), M + "/cover_portrait_1008x1440.png")
    save(compose(station, (1080, 360), (0.5, 0.62), 0.36, (0.22, 0.50), shade_k=0.6), M + "/mini_landscape_1080x360.png")
    save(logo(4000, shadow=False), M + "/logo_transparent.png")
    save(compose(city, (2560, 1440), (0.5, 0.5), 0.40, (0.50, 0.20)), M + "/trailer_cover_2560x1440.png")
    icon = Image.open(os.path.join(ROOT, "ios", "Antarktika", "Assets.xcassets", "AppIcon.appiconset", "Icon.png")).convert("RGB")
    save(icon.resize((512, 512), Image.LANCZOS), M + "/icon_512.png")
    save(cover(station, (180, 180), (0.30, 0.25), zoom=1.6), M + "/spatial_icon_background_180.png")
    fg = Image.new("RGBA", (180, 180), (0, 0, 0, 0))
    sig = icon.resize((144, 144), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (144, 144), 0)
    ImageDraw.Draw(mask).ellipse([4, 4, 140, 140], fill=255)
    sig.putalpha(mask.filter(ImageFilter.GaussianBlur(1)))
    fg.paste(sig, (18, 18), sig)
    save(fg, M + "/spatial_icon_foreground_180.png")
    pano = os.path.join(src_dir, "pano360_city.png")
    if os.path.exists(pano):
        p = Image.open(pano).convert("RGB").resize((7680, 3840), Image.LANCZOS)
        path = M + "/preview_360_equirect_7680x3840.jpg"
        for q in (88, 84, 80):          # Meta: JPEG quality >= 80, file <= 2.3 MB
            save(p, path, "JPEG", quality=q, optimize=True, progressive=True)
            if os.path.getsize(path) <= 2.3e6:
                break
        print("  360 preview", round(os.path.getsize(path) / 1e6, 2), "MB at quality", q)

    print("logo + pwa icons")
    save(logo(2400), os.path.join(out, "logo", "logo_light.png"))
    Q = os.path.join(ROOT, "quest", "icons")
    save(icon.resize((192, 192), Image.LANCZOS), Q + "/icon-192.png")
    save(icon.resize((512, 512), Image.LANCZOS), Q + "/icon-512.png")
    save(icon.resize((512, 512), Image.LANCZOS), Q + "/icon-512-maskable.png")   # full-bleed, opaque
    save(icon.resize((512, 512), Image.LANCZOS), os.path.join(ROOT, "steam", "icon.png"))   # electron-builder window / exe icon


if __name__ == "__main__":
    main()
