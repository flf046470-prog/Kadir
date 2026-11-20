"""Microsoft Store kit: Partner Center listing art and the package tile assets.

    python3 tools/make_msstore_kit.py

Sources: store/keyart/*.jpg (Cycles key art), steam/icon.png (app icon), store/steam/screenshots. Sizes follow learn.microsoft.com "App screenshots, images, and trailers
for MSIX app" (checked 2026-11-20):

  store/microsoft/listing/
    poster_2x3_1440x2160.png     2:3 poster art (main logo for games on Windows/Xbox), title included
    boxart_1x1_2160x2160.png     1:1 box art, title included
    tile_icon_300x300.png        1:1 app tile icon
    superhero_16x9_3840x2160.png 16:9 super hero art (needed for trailers to show at the top), no UI
    trailer_thumbnail_1920x1080.png
    screenshots/NN.png           desktop screenshots, PNG, 1920x1080 (>= 1366x768, max 10)
  steam/build/appx/              package tile assets electron-builder puts into the AppX/MSIX
    StoreLogo 50, Square44x44Logo 44, Square150x150Logo 150,
    Wide310x150Logo 310x150, SmallTile 71, LargeTile 310, SplashScreen 620x300
"""
import glob
import os

from PIL import Image

import make_store_kit as K

ROOT = K.ROOT
STORE = os.path.join(ROOT, "store")
OUT = os.path.join(STORE, "microsoft", "listing")
APPX = os.path.join(ROOT, "steam", "build", "appx")
BG = (3, 10, 16)


def ka(name):
    return Image.open(os.path.join(STORE, "keyart", name)).convert("RGB")


def icon_on(size, scale=1.0, bg=True):
    """The app icon centred on the tile; plated tiles keep the icon's own dark background."""
    ic = Image.open(os.path.join(ROOT, "steam", "icon.png")).convert("RGBA")
    W, H = size
    s = int(min(W, H) * scale)
    ic = ic.resize((s, s), Image.LANCZOS)
    im = Image.new("RGBA", size, BG + (255,) if bg else (0, 0, 0, 0))
    im.paste(ic, ((W - s) // 2, (H - s) // 2), ic)
    return im


def wide_tile(size):
    """Wide tile / splash: key art strip with the logotype."""
    return K.compose(ka("keyart_station.jpg"), size, (0.5, 0.62), 0.62, (0.5, 0.5), shade_k=0.55)


def main():
    os.makedirs(os.path.join(OUT, "screenshots"), exist_ok=True)
    print("listing")
    K.save(K.compose(ka("keyart_portrait.jpg"), (1440, 2160), (0.5, 0.55), 0.78, (0.5, 0.14), shade_k=0.5),
           os.path.join(OUT, "poster_2x3_1440x2160.png"), optimize=True)
    K.save(K.compose(ka("keyart_station.jpg"), (2160, 2160), (0.47, 0.5), 0.70, (0.5, 0.17), shade_k=0.5),
           os.path.join(OUT, "boxart_1x1_2160x2160.png"), optimize=True)
    K.save(icon_on((300, 300)).convert("RGB"), os.path.join(OUT, "tile_icon_300x300.png"), optimize=True)
    K.save(K.compose(ka("keyart_city.jpg"), (3840, 2160), (0.5, 0.5), 0.30, (0.25, 0.20), shade_k=0.5),
           os.path.join(OUT, "superhero_16x9_3840x2160.png"), optimize=True)
    K.save(K.compose(ka("keyart_station.jpg"), (1920, 1080), (0.5, 0.6), 0.42, (0.5, 0.22), shade_k=0.5),
           os.path.join(OUT, "trailer_thumbnail_1920x1080.png"), optimize=True)
    for i, f in enumerate(sorted(glob.glob(os.path.join(STORE, "steam", "screenshots", "*.jpg")))[:10], 1):
        K.save(Image.open(f).convert("RGB"), os.path.join(OUT, "screenshots", "%02d.png" % i), optimize=True)
    # trailer: upload store/steam/trailer_1080p.mp4 (1920x1080 H.264, 34 s) with trailer_thumbnail_1920x1080.png

    print("package tiles (steam/build/appx)")
    os.makedirs(APPX, exist_ok=True)
    for name, size, scale in (("StoreLogo.png", (50, 50), 1.0), ("Square44x44Logo.png", (44, 44), 1.0),
                              ("Square150x150Logo.png", (150, 150), 0.72), ("SmallTile.png", (71, 71), 0.8),
                              ("LargeTile.png", (310, 310), 0.62)):
        K.save(icon_on(size, scale), os.path.join(APPX, name))
    K.save(wide_tile((310, 150)), os.path.join(APPX, "Wide310x150Logo.png"))
    K.save(wide_tile((620, 300)), os.path.join(APPX, "SplashScreen.png"))


if __name__ == "__main__":
    main()
