import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * The native shell.
 *
 * FioreMatch is a server-rendered application: sessions are httpOnly cookies,
 * Discover and the conversation are `force-dynamic`, and every read goes
 * through an API route that checks membership against the database. A static
 * export — the usual way to put a web app inside Capacitor — would ship a
 * build with no server, no session and no data. So the shell loads the
 * deployed site instead, and what is native is the *container*: push
 * notifications, deep links, the status bar, the keyboard and the back button.
 *
 * That means one codebase. A change to the matching engine reaches the phone
 * on the next deploy rather than on the next store review, which for a product
 * this early is worth more than bundling the frontend.
 *
 * The trade is honest and worth stating: the app needs a connection to start.
 * `errorPath` is what stops that being a raw webview error — see
 * `mobile/shell/error.html`.
 */

const url = process.env.CAPACITOR_SERVER_URL ?? "https://fiorematch.com";
const { host } = new URL(url);

const config: CapacitorConfig = {
  appId: "com.fiorematch.app",
  appName: "FioreMatch",

  // Required by the CLI even when the app loads a remote URL. It holds the
  // local error page rather than a copy of the site.
  webDir: "mobile/shell",

  server: {
    url,
    errorPath: "error.html",
    /**
     * `https` rather than Capacitor's default custom scheme. The session
     * cookie is `Secure`, and a webview served over `capacitor://` is not a
     * secure context for cookie purposes — members would be signed out on
     * every launch.
     */
    androidScheme: "https",
    // Never fall back to plain HTTP. A dating app's session cookie on an
    // open network is not a trade worth making for a dev convenience.
    cleartext: false,
    /**
     * Only our own host navigates inside the webview. Anything else — a link
     * someone pastes into a conversation, an external policy page — is handed
     * to the system browser, where the address bar tells the member where they
     * actually are. That is the difference between a link and a phishing page.
     */
    allowNavigation: [host]
  },

  android: {
    // Both native projects live under `mobile/` rather than at the repository
    // root, so the web app and the two store builds are separable at a glance.
    path: "mobile/android",
    backgroundColor: "#fff5f7"
  },

  ios: {
    path: "mobile/ios",
    backgroundColor: "#fff5f7",
    // Let the page paint under the status bar so the app looks installed
    // rather than framed; the layout already pays for it with safe-area insets.
    contentInset: "never"
  },

  plugins: {
    SplashScreen: {
      // Hidden by the app itself once the first screen is actually ready,
      // rather than on a timer that is either too short (white flash) or too
      // long (a splash screen nobody needs).
      launchAutoHide: false,
      backgroundColor: "#fff5f7",
      androidSplashResourceName: "splash",
      showSpinner: false
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#fff5f7"
    },
    PushNotifications: {
      // A notification that arrives while the app is open should still be
      // seen; without this Android silently drops it into the void.
      presentationOptions: ["badge", "sound", "alert"]
    },
    Keyboard: {
      /**
       * Resize the webview itself, so the composer rises with the keyboard
       * instead of sitting under it.
       *
       * Untested on a device from here — there is no emulator in this
       * environment — so this is the documented default rather than a measured
       * choice. `docs/mobile.md` flags it as the first thing to check on real
       * hardware, along with where the bottom tabs land while typing.
       */
      resize: KeyboardResize.Native
    }
  }
};

export default config;
