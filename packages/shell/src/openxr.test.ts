import { describe, expect, it } from 'vitest';

import { browserCandidates, hasOpenXrRuntime, openXrRuntimePaths, planVrLaunch } from './openxr.js';
import type { HostProbe, Platform } from './openxr.js';

function host(platform: Platform, present: string[], env: Record<string, string> = {}): HostProbe {
  const set = new Set(present);
  return {
    platform,
    exists: (path) => set.has(path),
    env: (name) => env[name],
  };
}

const WIN_ENV = {
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local',
};
const WIN_RUNTIME = 'C:\\ProgramData\\Khronos\\OpenXR\\1\\active_runtime.json';
const WIN_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIN_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

describe('OpenXR runtime discovery', () => {
  it('looks for the Khronos active-runtime record on Windows', () => {
    expect(openXrRuntimePaths(host('win32', [], WIN_ENV))).toContain(WIN_RUNTIME);
  });

  it('honours XDG_CONFIG_HOME on Linux', () => {
    const paths = openXrRuntimePaths(host('linux', [], { XDG_CONFIG_HOME: '/home/p/.cfg' }));
    expect(paths[0]).toBe('/home/p/.cfg/openxr/1/active_runtime.json');
    expect(paths).toContain('/usr/share/openxr/1/active_runtime.json');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const paths = openXrRuntimePaths(host('linux', [], { HOME: '/home/p' }));
    expect(paths[0]).toBe('/home/p/.config/openxr/1/active_runtime.json');
  });

  it('reports no runtime on macOS, where OpenXR does not exist', () => {
    expect(openXrRuntimePaths(host('darwin', []))).toEqual([]);
    expect(hasOpenXrRuntime(host('darwin', []))).toBe(false);
  });

  it('detects a runtime when any known record is present', () => {
    expect(hasOpenXrRuntime(host('win32', [WIN_RUNTIME], WIN_ENV))).toBe(true);
    expect(hasOpenXrRuntime(host('win32', [], WIN_ENV))).toBe(false);
  });
});

describe('browser discovery', () => {
  it('only returns browsers that exist on disk', () => {
    expect(browserCandidates(host('win32', [], WIN_ENV))).toEqual([]);
    expect(browserCandidates(host('win32', [WIN_CHROME], WIN_ENV))).toEqual([
      { name: 'Google Chrome', path: WIN_CHROME },
    ]);
  });

  it('prefers Chrome over Edge when both are installed', () => {
    const found = browserCandidates(host('win32', [WIN_EDGE, WIN_CHROME], WIN_ENV));
    expect(found[0]?.name).toBe('Google Chrome');
    expect(found.map((b) => b.name)).toContain('Microsoft Edge');
  });

  it('finds Chromium on Linux', () => {
    const found = browserCandidates(host('linux', ['/usr/bin/chromium']));
    expect(found).toEqual([{ name: 'Chromium', path: '/usr/bin/chromium' }]);
  });
});

describe('VR launch plan', () => {
  const url = 'http://127.0.0.1:8787/?vr=1';
  const profile = 'C:\\Users\\p\\AppData\\Local\\KangarooChase\\vr-profile';

  it('produces a chrome-less, isolated-profile launch when everything is present', () => {
    const plan = planVrLaunch(host('win32', [WIN_RUNTIME, WIN_CHROME], WIN_ENV), url, profile);
    expect(plan.available).toBe(true);
    expect(plan.browser?.path).toBe(WIN_CHROME);
    expect(plan.args).toContain(`--app=${url}`);
    // Without its own profile the launch attaches to a running browser and the flags are ignored.
    expect(plan.args).toContain(`--user-data-dir=${profile}`);
    expect(plan.args).toContain('--start-fullscreen');
  });

  it('explains a missing runtime rather than failing silently', () => {
    const plan = planVrLaunch(host('win32', [WIN_CHROME], WIN_ENV), url, profile);
    expect(plan.available).toBe(false);
    expect(plan.reason).toMatch(/SteamVR/);
    expect(plan.args).toBeUndefined();
  });

  it('explains a missing browser separately from a missing runtime', () => {
    const plan = planVrLaunch(host('win32', [WIN_RUNTIME], WIN_ENV), url, profile);
    expect(plan.available).toBe(false);
    expect(plan.reason).toMatch(/Chrome or Microsoft Edge/);
  });

  it('never offers VR on macOS', () => {
    const plan = planVrLaunch(host('darwin', ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']), url, profile);
    expect(plan.available).toBe(false);
    expect(plan.reason).toMatch(/macOS/);
  });

  it('works on Linux with SteamVR installed', () => {
    const probe = host('linux', ['/usr/share/openxr/1/active_runtime.json', '/usr/bin/google-chrome']);
    const plan = planVrLaunch(probe, url, '/home/p/.cache/kc-vr');
    expect(plan.available).toBe(true);
    expect(plan.browser?.name).toBe('Google Chrome');
  });
});
