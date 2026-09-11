/**
 * The two files the platforms fetch to believe a link belongs to this app.
 *
 * Android reads `/.well-known/assetlinks.json`, iOS reads
 * `/.well-known/apple-app-site-association`. Until each is served *and*
 * correct, a tapped referral link either shows an "open with" chooser
 * (Android) or just opens Safari (iOS).
 *
 * Both are built from environment variables rather than committed, because
 * both depend on secrets-adjacent facts that only exist once the app is
 * signed: the release certificate's fingerprint, and the Apple team id.
 *
 * When a value is missing these return null and the route answers 404. That is
 * deliberate and it matters: Android caches a *failed* verification and will
 * not retry for a long time, so serving a placeholder is worse than serving
 * nothing — it poisons the result until the app is reinstalled.
 */

export const ANDROID_PACKAGE = "com.fiorematch.app";
export const IOS_BUNDLE_ID = "com.fiorematch.app";

/** `AB:CD:…` — 32 hex pairs, as `keytool -list -v` prints it. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Apple team ids are 10 alphanumerics. */
const TEAM_ID = /^[0-9A-Z]{10}$/;

export function normaliseFingerprint(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return FINGERPRINT.test(value) ? value : null;
}

/**
 * Android App Links.
 *
 * Accepts several fingerprints, comma-separated: an app is normally signed by
 * both an upload key and Play's app-signing key, and a file that lists only
 * one of them verifies for exactly half the installs.
 */
export function assetLinks(rawFingerprints: string | undefined): unknown[] | null {
  if (!rawFingerprints) return null;

  const fingerprints = rawFingerprints
    .split(",")
    .map((entry) => normaliseFingerprint(entry))
    .filter((entry): entry is string => entry !== null);

  if (fingerprints.length === 0) return null;

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints
      }
    }
  ];
}

/**
 * iOS Universal Links.
 *
 * `/api/*` is excluded. Those paths are for the app's own `fetch` calls, and a
 * link to one arriving from outside should not launch the app to render a JSON
 * body it has no screen for.
 */
export function appleAppSiteAssociation(teamId: string | undefined): unknown | null {
  const team = teamId?.trim().toUpperCase();
  if (!team || !TEAM_ID.test(team)) return null;

  return {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${IOS_BUNDLE_ID}`],
          components: [
            { "/": "/api/*", exclude: true, comment: "Data endpoints, not screens." },
            { "/": "/*" }
          ]
        }
      ]
    }
  };
}
