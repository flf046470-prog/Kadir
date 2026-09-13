import { afterEach, describe, expect, it } from "vitest";
import { publicSiteEnabled, signupsOpen, supportEmail } from "./site";

afterEach(() => {
  delete process.env.SIGNUPS;
  delete process.env.PUBLIC_SITE;
});

describe("the deployment switches", () => {
  /**
   * The two are independent on purpose. Photo screening blocks *signups*: no
   * photo can reach anyone before there is somebody to upload it. The marketing
   * site has no such dependency, so a deployment can publish twelve locales of
   * indexable pages — and start accruing the age search ranking is mostly made
   * of — while the product behind them stays shut.
   */
  it("are independent of each other", () => {
    process.env.SIGNUPS = "closed";
    expect(signupsOpen()).toBe(false);
    expect(publicSiteEnabled()).toBe(true);

    process.env.PUBLIC_SITE = "off";
    delete process.env.SIGNUPS;
    expect(signupsOpen()).toBe(true);
    expect(publicSiteEnabled()).toBe(false);
  });

  it("both default to open, so a local checkout works unconfigured", () => {
    expect(signupsOpen()).toBe(true);
    expect(publicSiteEnabled()).toBe(true);
  });

  /**
   * Only the exact word closes it. A truthy-looking value that does not match
   * would otherwise read as "closed" to whoever set it and "open" to the
   * server, which is the wrong direction to be wrong in for this switch.
   */
  it("closes signups only on the exact value", () => {
    for (const value of ["closed"]) {
      process.env.SIGNUPS = value;
      expect(signupsOpen()).toBe(false);
    }

    for (const value of ["true", "off", "no", "0", ""]) {
      process.env.SIGNUPS = value;
      expect(signupsOpen()).toBe(true);
    }
  });
});

describe("the support address", () => {
  /**
   * Not an environment variable, deliberately: it belongs to the brand rather
   * than to a deployment, and a staging server that quietly rerouted support
   * mail would be a way to lose a real person's message. Both stores require a
   * working contact on the listing.
   */
  it("is a constant, not configuration", () => {
    expect(supportEmail).toBe("support@fiorematch.com");
  });
});
