/**
 * Desktop VR launch planning.
 *
 * Why this exists at all, since the game is already a WebXR app:
 *
 * Electron cannot host a WebXR session. It sets `checkout_webxr` to false in its DEPS, which
 * leaves `enable_vr=false` in the Chromium build, so `navigator.xr` never exposes an immersive
 * device no matter what runtime is installed. That is a compile-time property of the Electron
 * binary, not a flag we can pass. Meanwhile desktop Chrome and Edge *do* ship WebXR and drive
 * it through the system OpenXR runtime — which is exactly what SteamVR provides.
 *
 * So the Steam build is a two-surface app: the Electron window serves flat play, and "Play in
 * VR" hands off to a Chromium-class browser in app mode pointed at the same local server. This
 * module is the part of that worth testing — where the runtime lives, which browser to use, and
 * what to pass it — kept free of Electron and of the filesystem so it can be unit tested.
 */

export type Platform = 'win32' | 'darwin' | 'linux';

/** Injected so the planner stays pure and testable. */
export interface HostProbe {
  platform: Platform;
  /** True when the path exists on disk. */
  exists(path: string): boolean;
  /** Environment lookup; returns undefined when unset. */
  env(name: string): string | undefined;
}

export interface BrowserCandidate {
  /** Human-readable name for the UI ("Play in VR — using Google Chrome"). */
  name: string;
  path: string;
}

/**
 * Where an OpenXR runtime registers itself.
 *
 * On Windows the active runtime is a registry value, which we cannot read from here without
 * spawning a process — so the presence of the vendor runtime files is used as the signal
 * instead. It is a weaker check, and deliberately so: a false positive costs an unnecessary
 * button, while a false negative hides VR from someone who has a working headset.
 */
export function openXrRuntimePaths(host: HostProbe): string[] {
  switch (host.platform) {
    case 'win32': {
      const programData = host.env('ProgramData') ?? 'C:\\ProgramData';
      const programFiles = host.env('ProgramFiles') ?? 'C:\\Program Files';
      return [
        `${programData}\\Khronos\\OpenXR\\1\\active_runtime.json`,
        `${programFiles}\\Oculus\\Support\\oculus-runtime\\oculus_openxr_64.json`,
        `${programFiles} (x86)\\Steam\\steamapps\\common\\SteamVR\\steamxr_win64.json`,
      ];
    }
    case 'linux': {
      const config = host.env('XDG_CONFIG_HOME') ?? `${host.env('HOME') ?? '~'}/.config`;
      return [
        `${config}/openxr/1/active_runtime.json`,
        '/usr/share/openxr/1/active_runtime.json',
        '/etc/xdg/openxr/1/active_runtime.json',
      ];
    }
    case 'darwin':
      // No OpenXR runtime ships for macOS, so the VR path is never offered there.
      return [];
  }
}

export function hasOpenXrRuntime(host: HostProbe): boolean {
  return openXrRuntimePaths(host).some((path) => host.exists(path));
}

/**
 * Browsers that ship WebXR and drive it through the system OpenXR runtime, most-preferred
 * first. Chrome and Edge are the same engine here; Chrome is listed first only because its
 * WebXR support is the more widely tested of the two.
 */
export function browserCandidates(host: HostProbe): BrowserCandidate[] {
  const paths: BrowserCandidate[] = [];
  const push = (name: string, path: string) => paths.push({ name, path });

  switch (host.platform) {
    case 'win32': {
      const pf = host.env('ProgramFiles') ?? 'C:\\Program Files';
      const pf86 = host.env('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)';
      const local = host.env('LOCALAPPDATA') ?? '';
      push('Google Chrome', `${pf}\\Google\\Chrome\\Application\\chrome.exe`);
      push('Google Chrome', `${pf86}\\Google\\Chrome\\Application\\chrome.exe`);
      if (local) push('Google Chrome', `${local}\\Google\\Chrome\\Application\\chrome.exe`);
      push('Microsoft Edge', `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`);
      push('Microsoft Edge', `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`);
      break;
    }
    case 'linux': {
      push('Google Chrome', '/usr/bin/google-chrome');
      push('Google Chrome', '/opt/google/chrome/chrome');
      push('Chromium', '/usr/bin/chromium');
      push('Chromium', '/usr/bin/chromium-browser');
      push('Microsoft Edge', '/usr/bin/microsoft-edge');
      break;
    }
    case 'darwin':
      // Listed for completeness; macOS has no OpenXR runtime, so this is never reached.
      push('Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      break;
  }

  return paths.filter((candidate) => host.exists(candidate.path));
}

export interface VrLaunchPlan {
  available: boolean;
  /** Present when `available`. */
  browser?: BrowserCandidate;
  args?: string[];
  /** Why VR is unavailable, phrased for the player rather than the log. */
  reason?: string;
}

/**
 * Build the command line for the VR handoff.
 *
 * `--app=` gives a chrome-less window, which matters because the player is about to put a
 * headset on and cannot use a URL bar. A dedicated `--user-data-dir` is not optional: without
 * it the launch silently attaches to an already-running browser process and none of these flags
 * apply, which presents as "VR just doesn't start" with nothing in any log.
 */
export function planVrLaunch(host: HostProbe, url: string, profileDir: string): VrLaunchPlan {
  if (host.platform === 'darwin') {
    return { available: false, reason: 'No OpenXR runtime exists for macOS, so VR is unavailable on this platform.' };
  }
  if (!hasOpenXrRuntime(host)) {
    return {
      available: false,
      reason: 'No OpenXR runtime found. Install and run SteamVR (or the Meta Quest Link app), then try again.',
    };
  }
  const browser = browserCandidates(host)[0];
  if (!browser) {
    return {
      available: false,
      reason: 'VR needs Google Chrome or Microsoft Edge installed — they provide the WebXR support that drives your headset.',
    };
  }
  return {
    available: true,
    browser,
    args: [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      '--start-fullscreen',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  };
}
