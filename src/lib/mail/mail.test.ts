import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailConfigured, mailProvider, sendMail } from "./mail";
import { sendWithResend } from "./resend";
import { verifyEmailMessage } from "./templates";

const KEYS = ["MAIL_PROVIDER", "RESEND_API_KEY", "MAIL_FROM"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("choosing a driver", () => {
  it("uses Resend as soon as there is a key", () => {
    process.env.RESEND_API_KEY = "re_test";

    expect(mailProvider()).toBe("resend");
    expect(mailConfigured()).toBe(true);
  });

  /**
   * The one that matters.
   *
   * A production deploy with no mail provider must not reach the console
   * driver: that would print a member's verification link into a server log
   * and report a successful send, so the registration screen would tell them
   * to check an inbox nothing was sent to, and nothing anywhere would say so.
   */
  it("sends nothing, loudly, in production with no key", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(mailProvider()).toBe("none");
    expect(mailConfigured()).toBe(false);
    await expect(sendMail(message())).resolves.toEqual({
      sent: false,
      reason: "not_configured"
    });
  });

  it("falls back to the console outside production, so the link is readable", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(mailProvider()).toBe("console");
    await expect(sendMail(message())).resolves.toEqual({ sent: true, id: "console" });
    // The body, not a summary — the point of this driver is the link.
    expect(info.mock.calls[0][0]).toContain("https://fiorematch.com/tr/verify-email?token=abc");

    info.mockRestore();
  });

  it("lets a deployment name the driver explicitly", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.MAIL_PROVIDER = "console";
    expect(mailProvider()).toBe("console");

    process.env.MAIL_PROVIDER = "none";
    process.env.RESEND_API_KEY = "re_test";
    // An explicit "none" beats a key being present: that is how you stop a
    // staging deploy mailing real people.
    expect(mailProvider()).toBe("none");
  });
});

describe("the Resend driver", () => {
  it("refuses without a key rather than calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWithResend(message())).resolves.toEqual({
      sent: false,
      reason: "no_api_key"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the id the API returned", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }))
    );

    await expect(sendWithResend(message())).resolves.toEqual({ sent: true, id: "msg_1" });
  });

  /**
   * An accepted request with no id is not a send we can claim happened, and
   * the distinction is not academic: `verificationEmailSent` on the
   * registration response is derived from this, and a false positive there
   * means the member is told to check their inbox.
   */
  it("does not claim a send when the response carries no id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );

    await expect(sendWithResend(message())).resolves.toEqual({ sent: false, reason: "no_id" });
  });

  it("maps a refusal to its status without leaking the body", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("domain not verified for acme.example", { status: 403 }))
    );

    await expect(sendWithResend(message())).resolves.toEqual({ sent: false, reason: "http_403" });

    error.mockRestore();
  });

  it("sends from MAIL_FROM when a deployment sets one", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_FROM = "FioreMatch Staging <no-reply@staging.example>";
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ id: "msg_2" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendWithResend(message());

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe("FioreMatch Staging <no-reply@staging.example>");
    expect(body.to).toEqual(["new@example.com"]);
  });
});

describe("the verification message", () => {
  it("carries the link in the text part, on its own line", () => {
    const mail = built("tr");

    expect(mail.text).toContain("\nhttps://fiorematch.com/tr/verify-email?token=abc\n");
    expect(mail.html).toContain('href="https://fiorematch.com/tr/verify-email?token=abc"');
  });

  it("writes Turkish for a Turkish member and English for everyone else", () => {
    expect(built("tr").subject).toBe("FioreMatch hesabını doğrula");
    expect(built("en").subject).toBe("Verify your FioreMatch account");
    // An unwritten locale gets English rather than a template with a hole in it.
    expect(built("de").subject).toBe("Verify your FioreMatch account");
  });

  it("escapes a display name before putting it in the HTML part", () => {
    const mail = verifyEmailMessage({
      to: "new@example.com",
      displayName: '<img src=x onerror="alert(1)">',
      link: "https://fiorematch.com/en/verify-email?token=abc",
      locale: "en",
      expiresInHours: 24
    });

    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("names the support address, so a stuck member has somewhere to go", () => {
    expect(built("tr").text).toContain("support@fiorematch.com");
  });
});

function built(locale: string) {
  return verifyEmailMessage({
    to: "new@example.com",
    displayName: "Ayşe",
    link: `https://fiorematch.com/${locale}/verify-email?token=abc`,
    locale,
    expiresInHours: 24
  });
}

function message() {
  return built("tr");
}
