"""Build the game's public website (static, Turkish + English) into dist/site.

    python3 tools/build_site.py [out_dir]

    /                 Turkish landing page: key art, trailer, features, screenshots, platforms
    /en/              English landing page
    /play/            the game itself, playable in a desktop or Quest browser (copy of ios/Antarktika/Game)
    /gizlilik/ /en/privacy/   privacy policy (the URL App Store Connect, Steam and Meta ask for)
    /destek/   /en/support/   support page (App Store "Support URL")
    /assets/          resized key art, screenshots, a 720p trailer, logo, icons

The Meta Quest app keeps its own deployment from tools/build_web.py (game served at "/"), so this site
does not change the Quest flow. Set CONTACT below before publishing: the privacy and support pages need
a reachable address, and it is left as a visible placeholder until the owner picks one.
"""
import html
import os
import shutil
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME = os.path.join(ROOT, "ios", "Antarktika", "Game")
STORE = os.path.join(ROOT, "store")
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "site")

CONTACT = "iletisim@ALAN-ADINIZ"          # ← yayından önce gerçek destek adresiyle değiştirin
STORE_LINKS = {"appstore": "", "steam": "", "quest": ""}   # mağaza sayfaları açılınca bağlantıları girin
UPDATED = "14 Kasım 2026"
UPDATED_EN = "14 November 2026"

SHOTS = [  # clean in-engine frames (no HUD), file stem → (TR caption, EN caption)
    ("01_g2_ramp_door", "HELIKON-14 araştırma istasyonu", "Research station HELIKON-14"),
    ("02_g7_crystals", "Kristal mağarası", "The crystal cave"),
    ("03_h1_hall_stars", "İnsanlıktan eski taş salon", "A stone hall older than humankind"),
    ("04_c1_city_bridge", "Buz altı gölündeki şehir", "The city on the lake under the ice"),
    ("05_gr2_sync", "İki şebekeyi eşle", "Couple the two grids"),
    ("06_k1_camp_drone", "Termal dronlar sıcağı görür", "Thermal drones see warmth"),
    ("07_t1_tower_clock", "03:17 — kule saati", "03:17 — the tower clock"),
    ("08_g6_cave_torch", "Fenerle buzun altına", "Into the ice by torchlight"),
]

T = {
    "tr": {
        "lang": "tr", "title": "Antarktika: Whiteout — buzun altındaki şehir",
        "desc": "2091. Antarktika'daki HELIKON-14 istasyonu 03:17'de sustu. Yedi bölümlük birinci şahıs keşif ve bulmaca oyunu; üç farklı son. iPhone, Steam ve Meta Quest için.",
        "tag": "2091. İstasyon 03:17'de sustu. Buzulun üstünde kalan son mühendis sensin.",
        "play": "Tarayıcıda oyna", "trailer": "Fragmanı izle", "soon": "Yakında",
        "h_trailer": "Fragman", "h_feat": "Oyun", "h_shots": "Görüntüler", "h_plat": "Platformlar",
        "feats": [
            ("Yedi bölüm, üç son", "Kime güvendiğin, kimi kurtardığın ve ne kadar enerji çektiğin finali belirler."),
            ("Buzun altına in", "Araştırma istasyonu, buz mağarası, taş salon, göldeki şehir, iletim galerisi ve sondaj kampı."),
            ("Silahsız gerilim", "Termal dronlardan saklan: vücudun ne kadar sıcaksa o kadar uzaktan görünürsün."),
            ("Gerçek bulmacalar", "İki elektrik şebekesini eşle, pompayı basıncı sıfırlayarak durdur, kristal dilini çöz."),
            ("Hayatta kal", "Vücut ısısı, dayanıklılık ve değişen tipi. Sığınağa dönmeyi unutma."),
            ("Çevrimdışı ve temiz", "Tam kayıt, reklam yok, uygulama içi satın alma yok, veri toplama yok."),
        ],
        "plats": [("iPhone", "App Store", "appstore"), ("PC ve SteamVR", "Steam", "steam"), ("Meta Quest", "Meta Horizon Store", "quest")],
        "play_note": "Tarayıcı sürümü masaüstünde ve Quest tarayıcısında çalışır; WebGL gerekir.",
        "privacy": "Gizlilik", "support": "Destek", "other": "English", "other_href": "/en/",
        "privacy_href": "/gizlilik/", "support_href": "/destek/",
        "foot": "Antarktika: Whiteout. Tüm 3D içerik geliştirici tarafından Blender'da üretildi.",
    },
    "en": {
        "lang": "en", "title": "Antarktika: Whiteout — the city beneath the ice",
        "desc": "2091. Research station HELIKON-14 in Antarctica went silent at 03:17. A seven-chapter first-person exploration and puzzle game with three endings. For iPhone, Steam and Meta Quest.",
        "tag": "2091. The station went silent at 03:17. You are the last engineer on the glacier.",
        "play": "Play in your browser", "trailer": "Watch the trailer", "soon": "Coming soon",
        "h_trailer": "Trailer", "h_feat": "The game", "h_shots": "Screenshots", "h_plat": "Platforms",
        "feats": [
            ("Seven chapters, three endings", "Who you trust, who you rescue and how much power you take decide the finale."),
            ("Descend beneath the ice", "A research station, an ice cave, a stone hall, a city on a lake, a transmission gallery and a drilling camp."),
            ("Unarmed tension", "Hide from thermal drones: the warmer you are, the farther away they see you."),
            ("Real-world puzzles", "Couple two power grids in phase, stop a drill pump by bleeding its pressure, decode a crystal language."),
            ("Survive the cold", "Body heat, stamina and a shifting blizzard. Don't forget the way back to shelter."),
            ("Offline and clean", "Full saves, no ads, no in-app purchases, no data collection."),
        ],
        "plats": [("iPhone", "App Store", "appstore"), ("PC and SteamVR", "Steam", "steam"), ("Meta Quest", "Meta Horizon Store", "quest")],
        "play_note": "The browser version runs on desktop and in the Quest browser; WebGL required.",
        "privacy": "Privacy", "support": "Support", "other": "Türkçe", "other_href": "/",
        "privacy_href": "/en/privacy/", "support_href": "/en/support/",
        "foot": "Antarktika: Whiteout. All 3D content made by the developer in Blender.",
    },
}

CSS = """
:root{--bg:#030a10;--bg2:#071824;--ink:#e8f6fb;--mute:#9bb6c2;--ice:#8fe3f0;--warm:#ffb078;--line:#ffffff1a}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--ice)}img,video{max-width:100%;display:block}
.wrap{width:min(1120px,100% - 32px);margin:0 auto}
header.top{position:absolute;inset:0 0 auto;z-index:3;display:flex;justify-content:space-between;align-items:center;padding:18px 24px}
header.top a{color:var(--ink);text-decoration:none;font-size:14px;letter-spacing:.08em;opacity:.85}
header.top nav{display:flex;gap:20px}
.hero{position:relative;min-height:100svh;display:grid;align-items:end;overflow:hidden}
.hero picture,.hero picture img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#030a1000 35%,#030a10d9 78%,var(--bg))}
.hero .wrap{position:relative;z-index:2;padding:0 0 9vh}
.hero h1{margin:0}.hero h1 img{width:min(620px,86vw);height:auto}.lb img{height:auto}
.hero p.tag{font-size:clamp(18px,2.4vw,24px);max-width:640px;margin:14px 0 26px;color:#d9eef5}
.btns{display:flex;flex-wrap:wrap;gap:12px}
.btn{display:inline-flex;align-items:center;gap:10px;padding:13px 22px;border-radius:999px;font-weight:700;text-decoration:none;letter-spacing:.02em}
.btn.primary{background:var(--warm);color:#1b0d03}.btn.ghost{border:1px solid #ffffff55;color:var(--ink)}
.btn:focus-visible{outline:3px solid var(--ice);outline-offset:3px}
section{padding:84px 0;border-top:1px solid var(--line)}
h2{font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:var(--warm);margin:0 0 26px}
.video{aspect-ratio:16/9;width:100%;border-radius:14px;overflow:hidden;background:#000;box-shadow:0 30px 80px #0009}
.video video{width:100%;height:100%}
.feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:18px}
.feat{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:22px}
.feat h3{margin:0 0 6px;font-size:19px}.feat p{margin:0;color:var(--mute)}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:14px}
.shots figure{margin:0}.shots a{display:block;border-radius:10px;overflow:hidden}
.shots img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;transition:transform .4s}
.shots a:hover img{transform:scale(1.03)}
.shots figcaption{font-size:14px;color:var(--mute);padding:8px 2px 0}
.plats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:14px}
.plat{border:1px solid var(--line);border-radius:14px;padding:20px 22px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--ink);text-decoration:none}
.plat b{display:block;font-size:18px}.plat small{color:var(--mute)}
.plat .pill{font-size:12px;letter-spacing:.1em;text-transform:uppercase;border:1px solid #ffffff40;border-radius:999px;padding:4px 10px;color:var(--mute);white-space:nowrap}
.note{color:var(--mute);font-size:14px;margin-top:18px}
footer{border-top:1px solid var(--line);padding:34px 0 48px;color:var(--mute);font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;justify-content:space-between}
footer nav{display:flex;gap:20px}
.doc{padding:120px 0 60px}.doc h1{font-size:34px;margin:0 0 6px}.doc h2{margin-top:38px}
.doc p,.doc li{color:#cfe3ea;max-width:760px}.doc .meta{color:var(--mute);font-size:14px}
.lb{position:fixed;inset:0;background:#000e;display:none;place-items:center;z-index:9;padding:16px}
.lb:target{display:grid}.lb img{max-height:92vh;width:auto;border-radius:8px}
.lb a.x{position:absolute;inset:0}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.shots img{transition:none}}
"""


def page(lang, title, desc, body, path):
    t = T[lang]
    alt = {"tr": "en", "en": "tr"}[lang]
    alt_path = {"/": "/en/", "/en/": "/", "/gizlilik/": "/en/privacy/", "/en/privacy/": "/gizlilik/",
                "/destek/": "/en/support/", "/en/support/": "/destek/"}[path]
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#06202e">
<link rel="icon" href="/assets/icon-192.png"><link rel="apple-touch-icon" href="/assets/icon-192.png">
<link rel="alternate" hreflang="{alt}" href="{alt_path}"><link rel="alternate" hreflang="{lang}" href="{path}">
<meta property="og:type" content="website"><meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}"><meta property="og:image" content="/assets/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<style>{CSS}</style>
</head>
<body>
<header class="top"><a href="{'/' if lang == 'tr' else '/en/'}">ANTARKTIKA</a>
<nav><a href="/play/">{t['play']}</a><a href="{t['other_href'] if path in ('/', '/en/') else alt_path}" hreflang="{alt}">{t['other']}</a></nav></header>
{body}
<footer><div class="wrap"><span>{t['foot']}</span>
<nav><a href="{t['privacy_href']}">{t['privacy']}</a><a href="{t['support_href']}">{t['support']}</a><a href="{alt_path}" hreflang="{alt}">{t['other']}</a></nav></div></footer>
</body></html>
"""


def landing(lang):
    t = T[lang]
    feats = "".join(f'<div class="feat"><h3>{html.escape(a)}</h3><p>{html.escape(b)}</p></div>' for a, b in t["feats"])
    shots, boxes = [], []
    for i, (stem, ctr, cen) in enumerate(SHOTS):
        cap = ctr if lang == "tr" else cen
        shots.append(f'<figure><a href="#s{i}"><img src="/assets/shots/{stem}_960.jpg" srcset="/assets/shots/{stem}_960.jpg 960w, /assets/shots/{stem}_1920.jpg 1920w" sizes="(max-width:760px) 100vw, 50vw" width="960" height="540" loading="lazy" alt="{html.escape(cap)}"></a><figcaption>{html.escape(cap)}</figcaption></figure>')
        boxes.append(f'<div class="lb" id="s{i}"><a class="x" href="#shots" aria-label="close"></a><img src="/assets/shots/{stem}_1920.jpg" alt="{html.escape(cap)}" loading="lazy"></div>')
    plats = ""
    for name, store, key in t["plats"]:
        href = STORE_LINKS[key]
        tag, attrs = ("a", f' href="{href}"') if href else ("div", "")
        pill = store if href else t["soon"]
        plats += f'<{tag} class="plat"{attrs}><span><b>{name}</b><small>{store}</small></span><span class="pill">{pill}</span></{tag}>'
    body = f"""<main>
<section class="hero" style="border:0;padding:0">
<picture><source media="(max-aspect-ratio: 4/5)" srcset="/assets/hero_portrait.jpg"><img src="/assets/hero.jpg" alt="" fetchpriority="high"></picture>
<div class="wrap"><h1><img src="/assets/logo.png" width="1200" height="291" alt="ANTARKTIKA: WHITEOUT"></h1>
<p class="tag">{html.escape(t['tag'])}</p>
<div class="btns"><a class="btn primary" href="/play/">▶ {t['play']}</a><a class="btn ghost" href="#trailer">{t['trailer']}</a></div></div>
</section>
<section id="trailer"><div class="wrap"><h2>{t['h_trailer']}</h2>
<div class="video"><video controls preload="none" playsinline poster="/assets/trailer_poster.jpg"><source src="/assets/trailer_720p.mp4" type="video/mp4"></video></div></div></section>
<section><div class="wrap"><h2>{t['h_feat']}</h2><div class="feats">{feats}</div></div></section>
<section id="shots"><div class="wrap"><h2>{t['h_shots']}</h2><div class="shots">{''.join(shots)}</div></div></section>
<section><div class="wrap"><h2>{t['h_plat']}</h2><div class="plats">{plats}</div>
<p class="note">{t['play_note']} <a href="/play/">{t['play']} →</a></p></div></section>
{''.join(boxes)}
</main>"""
    return page(lang, t["title"], t["desc"], body, "/" if lang == "tr" else "/en/")


def privacy(lang):
    if lang == "tr":
        body = f"""<main class="doc"><div class="wrap">
<h1>Gizlilik politikası</h1><p class="meta">Son güncelleme: {UPDATED}</p>
<p>Antarktika: Whiteout (iPhone, Steam ve Meta Quest sürümleri ile bu sitedeki tarayıcı sürümü) kişisel veri toplamaz, saklamaz ve paylaşmaz.</p>
<h2>Toplanan veriler</h2><p>Yok. Oyunda hesap, giriş, reklam, analiz aracı, çökme raporlayıcı ya da uygulama içi satın alma bulunmaz. Oyun internete bağlanmadan çalışır.</p>
<h2>Cihazda tutulanlar</h2><p>Oyun kaydınız (bulunduğunuz bölüm, konum, çözdüğünüz bulmacalar, ayarlar) yalnızca kendi cihazınızda saklanır: iPhone'da uygulamanın kendi depolamasında, tarayıcıda yerel depolamada (localStorage), Steam sürümünde bilgisayarınızdaki uygulama klasöründe. Bu veriler bize ya da üçüncü kişilere gönderilmez. Uygulamayı silmek veya tarayıcı verilerini temizlemek kaydı da siler.</p>
<h2>İzinler</h2><p>Oyun kamera, mikrofon, konum, rehber ya da fotoğraflara erişmez. VR sürümü yalnızca başlık ve kumanda konumunu oyunu çizmek için cihaz üzerinde kullanır; bu bilgi kaydedilmez ve gönderilmez.</p>
<h2>Bu web sitesi</h2><p>Site çerez kullanmaz ve analiz aracı içermez. Siteyi barındıran sunucu, her web sunucusu gibi teknik erişim kayıtları (IP adresi, tarih, istenen sayfa) tutabilir; bu kayıtlar yalnızca hizmeti işletmek için kullanılır.</p>
<h2>Çocuklar</h2><p>Hiçbir kullanıcıdan, çocuklar dahil, kişisel veri toplanmaz.</p>
<h2>Değişiklikler ve iletişim</h2><p>Bu politika değişirse güncel hali bu sayfada yayımlanır. Sorularınız için: <a href="mailto:{CONTACT}">{CONTACT}</a></p>
</div></main>"""
        return page("tr", "Gizlilik politikası — Antarktika: Whiteout", "Antarktika: Whiteout gizlilik politikası: kişisel veri toplanmaz.", body, "/gizlilik/")
    body = f"""<main class="doc"><div class="wrap">
<h1>Privacy policy</h1><p class="meta">Last updated: {UPDATED_EN}</p>
<p>Antarktika: Whiteout (the iPhone, Steam and Meta Quest versions, and the browser version on this site) does not collect, store or share personal data.</p>
<h2>Data collected</h2><p>None. The game has no account, sign-in, advertising, analytics, crash reporter or in-app purchases. It runs without an internet connection.</p>
<h2>Stored on your device</h2><p>Your save (current chapter, position, solved puzzles, settings) stays on your own device only: in the app's own storage on iPhone, in local storage (localStorage) in a browser, and in the app folder on your computer for the Steam version. It is never sent to us or to anyone else. Deleting the app or clearing browser data deletes the save.</p>
<h2>Permissions</h2><p>The game does not access the camera, microphone, location, contacts or photos. The VR version uses headset and controller position on the device only, to draw the game; it is neither recorded nor transmitted.</p>
<h2>This website</h2><p>The site uses no cookies and no analytics. Like any web server, the host may keep technical access logs (IP address, time, page requested), used only to operate the service.</p>
<h2>Children</h2><p>No personal data is collected from any user, including children.</p>
<h2>Changes and contact</h2><p>If this policy changes, the current version is published on this page. Questions: <a href="mailto:{CONTACT}">{CONTACT}</a></p>
</div></main>"""
    return page("en", "Privacy policy — Antarktika: Whiteout", "Antarktika: Whiteout privacy policy: no personal data is collected.", body, "/en/privacy/")


def support(lang):
    if lang == "tr":
        body = f"""<main class="doc"><div class="wrap">
<h1>Destek</h1><p class="meta">Antarktika: Whiteout</p>
<h2>Kontroller</h2><ul>
<li><b>iPhone:</b> sol alttaki analog çubukla yürü, ekranın sağ yarısını sürükleyerek bak; sağ alttaki tuşlar: E etkileş, Q tara, F fener, J günlük, KOŞ.</li>
<li><b>Bilgisayar:</b> WASD yürü, fare bak, Shift koş, E etkileş, Q tara, F fener, J günlük, H arayüzü gizle. Oyun kumandası desteklenir.</li>
<li><b>VR:</b> sol çubukla yürü, sağ çubukla kademeli dön; tetikle etkileş.</li></ul>
<h2>Sık sorulanlar</h2>
<p><b>Kaydım nerede?</b> Oyun her bölüm ve bulmacadan sonra otomatik kaydeder. Ana menüde “Devam et” kaldığın yerden açar. Kayıt yalnızca cihazında tutulur.</p>
<p><b>Oyun yavaş çalışıyor.</b> Menü ▸ Ayarlar'dan grafik kalitesini “Düşük” ya da “Dengeli” yap.</p>
<p><b>Hedefimi kaybettim.</b> Üst ortadaki pusula ve sol üstteki görev satırı her zaman bir sonraki hedefi gösterir. J ile günlüğü aç.</p>
<p><b>Üşüyorum, ekran donuyor.</b> Vücut ısın düşüyor: bir sığınağa ya da ısı kaynağına dön.</p>
<h2>İletişim</h2><p>Hata bildirimi ve sorular için: <a href="mailto:{CONTACT}">{CONTACT}</a>. Cihaz modelini, oyun sürümünü ve hangi bölümde olduğunu yazarsan daha hızlı yardımcı olabiliriz.</p>
</div></main>"""
        return page("tr", "Destek — Antarktika: Whiteout", "Antarktika: Whiteout destek: kontroller, sık sorulanlar ve iletişim.", body, "/destek/")
    body = f"""<main class="doc"><div class="wrap">
<h1>Support</h1><p class="meta">Antarktika: Whiteout</p>
<h2>Controls</h2><ul>
<li><b>iPhone:</b> walk with the analog stick at bottom left, drag the right half of the screen to look; buttons at bottom right: E interact, Q scan, F torch, J journal, RUN.</li>
<li><b>Computer:</b> WASD walk, mouse look, Shift run, E interact, Q scan, F torch, J journal, H hide the HUD. Gamepads are supported.</li>
<li><b>VR:</b> left stick walks, right stick snap-turns; trigger interacts.</li></ul>
<h2>FAQ</h2>
<p><b>Where is my save?</b> The game saves automatically after every chapter and puzzle. “Continue” in the main menu resumes where you left off. The save stays on your device only.</p>
<p><b>The game runs slowly.</b> Set graphics quality to “Low” or “Balanced” in Menu ▸ Settings.</p>
<p><b>I lost my objective.</b> The compass at top centre and the mission line at top left always name the next goal. Press J for the journal.</p>
<p><b>The screen frosts over.</b> Your body heat is dropping: head back to a shelter or a heat source.</p>
<h2>Contact</h2><p>Bug reports and questions: <a href="mailto:{CONTACT}">{CONTACT}</a>. Mention your device, the game version and the chapter you were in.</p>
</div></main>"""
    return page("en", "Support — Antarktika: Whiteout", "Antarktika: Whiteout support: controls, FAQ and contact.", body, "/en/support/")


def jpg(src, dst, w, q=82, crop=None):
    im = Image.open(src).convert("RGB")
    if crop:
        im = crop(im)
    h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(dst, quality=q, optimize=True, progressive=True)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    A = os.path.join(OUT, "assets")
    os.makedirs(os.path.join(A, "shots"))
    shutil.copytree(GAME, os.path.join(OUT, "play"))
    ka = os.path.join(STORE, "keyart")
    jpg(os.path.join(ka, "keyart_station.jpg"), os.path.join(A, "hero.jpg"), 2400, 80)
    jpg(os.path.join(ka, "keyart_portrait.jpg"), os.path.join(A, "hero_portrait.jpg"), 1200, 80)
    jpg(os.path.join(STORE, "meta", "cover_landscape_2560x1440.png"), os.path.join(A, "og.jpg"), 1200, 82)
    jpg(os.path.join(STORE, "meta", "trailer_cover_2560x1440.png"), os.path.join(A, "trailer_poster.jpg"), 1280, 82)
    logo = Image.open(os.path.join(STORE, "logo", "logo_light.png"))
    logo.resize((1200, round(logo.height * 1200 / logo.width)), Image.LANCZOS).save(os.path.join(A, "logo.png"), optimize=True)
    shutil.copy(os.path.join(ROOT, "quest", "icons", "icon-192.png"), os.path.join(A, "icon-192.png"))
    for stem, _, _ in SHOTS:
        src = os.path.join(STORE, "quest", "screenshots", stem + ".jpg")
        jpg(src, os.path.join(A, "shots", stem + "_960.jpg"), 960)
        jpg(src, os.path.join(A, "shots", stem + "_1920.jpg"), 1920)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(STORE, "steam", "trailer_1080p.mp4"),
                    "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", os.path.join(A, "trailer_720p.mp4")], check=True)
    pages = {"index.html": landing("tr"), "en/index.html": landing("en"),
             "gizlilik/index.html": privacy("tr"), "en/privacy/index.html": privacy("en"),
             "destek/index.html": support("tr"), "en/support/index.html": support("en")}
    for rel, s in pages.items():
        p = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w", encoding="utf-8").write(s)
    open(os.path.join(OUT, "404.html"), "w", encoding="utf-8").write(
        page("tr", "Sayfa bulunamadı — Antarktika: Whiteout", "", '<main class="doc"><div class="wrap"><h1>Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a> · <a href="/en/">English</a></p></div></main>', "/"))
    open(os.path.join(OUT, "robots.txt"), "w").write("User-agent: *\nAllow: /\n")
    open(os.path.join(OUT, "vercel.json"), "w").write(
        '{\n  "cleanUrls": true,\n  "headers": [\n'
        '    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] },\n'
        '    { "source": "/play/models/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] }\n  ]\n}\n')
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print("site →", OUT, "%.1f MB" % (size / 1e6), "contact placeholder:" if "ALAN-ADINIZ" in CONTACT else "contact:", CONTACT)


if __name__ == "__main__":
    main()
