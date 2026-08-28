# mobile/

Everything that exists because FioreMatch ships to the app stores. The web app
under `src/` does not import anything from here.

```
mobile/
  android/    Capacitor Android project — committed, opens in Android Studio
  ios/        README only; `npx cap add ios` needs macOS and writes here
  shell/      error.html — the screen shown when the site cannot be reached
  assets/     icon + splash generation, and the iOS 1024 master it produces
  store/      listing metadata, the privacy manifest, submission checklists
```

`capacitor.config.ts` stays at the repository root, because that is where the
Capacitor CLI looks for it. It points `android.path` and `ios.path` here.

## The shape of the app

The shell loads the deployed site rather than bundling a static export — see
`docs/mobile.md` for why that is forced rather than lazy. What is native is the
container: push notifications, deep links, the status bar, the keyboard and the
Android back button.

## Commands

```bash
npm run native:sync      # copy config + plugins into the native projects
npm run native:assets    # regenerate launcher icons and splash from the mark
npm run native:android   # open Android Studio
npm run native:ios       # open Xcode (after `npx cap add ios` on a Mac)
```

`CAPACITOR_SERVER_URL` chooses which deploy the shell loads:

```bash
CAPACITOR_SERVER_URL=https://staging.fiorematch.com npm run native:sync
```
