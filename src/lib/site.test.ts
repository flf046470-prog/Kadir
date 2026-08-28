import { describe, expect, it } from "vitest";
import { allowedAppHosts, siteUrl } from "./site";

describe("deep-link hosts", () => {
  it("covers the canonical host and its www form", () => {
    expect(allowedAppHosts()).toEqual(["fiorematch.com", "www.fiorematch.com"]);
  });

  it("stays derived from the site URL rather than hard-coded", () => {
    // If someone changes `siteUrl`, this list has to follow — a stale entry is
    // either a broken referral link or a host we no longer own.
    expect(allowedAppHosts()[0]).toBe(new URL(siteUrl).hostname);
  });

  it("lists each host once", () => {
    const hosts = allowedAppHosts();
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
