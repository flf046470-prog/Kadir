# Steam — submission

## What is in this folder

`npm run store:steam` writes eleven images into `assets/`, at Valve's sizes:

| File | Size | Where Steam shows it |
| --- | --- | --- |
| `header-capsule-460x215.png` | 460×215 | the top of the store page |
| `small-capsule-231x87.png` | 231×87 | search results and list rows |
| `main-capsule-616x353.png` | 616×353 | front-page and category features |
| `vertical-capsule-374x448.png` | 374×448 | seasonal sale pages |
| `library-capsule-600x900.png` | 600×900 | the buyer's own library grid |
| `library-header-460x215.png` | 460×215 | the library detail header |
| `library-hero-3840x1240.png` | 3840×1240 | the banner across a library page |
| `library-logo-1280x720.png` | 1280×720 | overlaid on that banner — transparent |
| `page-background-1438x810.png` | 1438×810 | behind the store page |
| `community-icon-184x184.png` | 184×184 | the community hub |
| `client-icon-32x32.png` | 32×32 | the client's own list |

All drawn from `scripts/brand-mark.mjs`, so they cannot drift from the app icon.

**The client icon has to be converted to `.ico`** before upload — Valve takes no
PNG in that slot. One command on any machine with ImageMagick:
`magick client-icon-32x32.png client-icon.ico`.

## What is not here, and cannot be

**The build.** Steam distributes an executable, and FioreMatch does not have
one. The web application, the two mobile shells and the PWA are the product;
there is no Windows desktop target and no VR target.
[`../../docs/BUILDS.md`](../../docs/BUILDS.md) lists Steam as needing Unity,
because the Steam release was conceived as the VR version.

The store art is genuinely useful before that is resolved — it is needed on the
day the answer is yes, and it costs nothing to have ready — but no amount of
further work in this repository turns it into a Steam release.

## Three decisions, not one

Getting to a Steam page is not "finish the build". Three separate questions have
to be answered, and two of them are not engineering:

**1. What is the build?** Two honest routes:

- *Unity*, as `BUILDS.md` assumes — the VR product, which is a different
  product from the web app and a much larger piece of work.
- *A desktop wrapper* (Tauri, Electron) around the existing PWA, which is small
  and needs no Unity. But shipping a wrapped website on Steam is a weak
  product: Steam users expect an application, the storefront gives it no
  advantage over the browser, and it invites the review question below.

**2. The account.** Steamworks charges a recoupable fee per application and
requires a legal entity, a bank account and tax paperwork (a W-8BEN or W-8BEN-E
for a Turkish entity). None of that can be done from here.

**3. The policy question — the real one.** Steam is a games platform. Non-game
software goes through a separate review and Valve is selective about it, and a
dating service that connects strangers is a category the storefront has little
precedent for. There are also adult-content rules that a dating product will be
read against whether or not it carries adult content.

That is a **store policy risk**, and under the standing instruction it is
reported rather than worked around: I do not think Steam should be attempted
before the app is live on Play and the App Store, and I would not spend the
Steamworks fee on it until someone has read Valve's onboarding rules against
this specific product.

## Recommendation

Keep the art, park the store. Play and the App Store are where a dating product
is found; Steam and Meta are expansions that need a different product to exist
first. [`../../docs/LAUNCH_ORDER.md`](../../docs/LAUNCH_ORDER.md) puts both in
Stage 6, after there are members, and nothing found while producing these
images changes that.
