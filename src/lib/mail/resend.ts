import { siteName } from "@/lib/site";

/**
 * The Resend driver.
 *
 * Chosen over SMTP because the deployment is serverless: an SMTP conversation
 * is several round trips on a connection that has to stay open, which is the
 * one thing a function invocation is bad at. An HTTPS POST is a single request
 * that either returns an id or an error, and the error is readable.
 *
 * Deliberately hand-written against the documented REST shape rather than
 * pulling in the SDK. The whole surface we need is one endpoint with four
 * fields; a dependency that wraps it would be more code to audit than this
 * file, and it would make the timeout and the error mapping somebody else's
 * decision.
 */

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Ten seconds. A member is waiting on the other side of this: registration
 * sends the mail inline, so a provider having a slow minute must not turn into
 * a request that hangs until the platform kills it. Past this we give up, tell
 * the caller, and let them use the resend button.
 */
const TIMEOUT_MS = 10_000;

export type ResendOutcome = { sent: true; id: string } | { sent: false; reason: string };

/**
 * The `From` address.
 *
 * Must be on a domain verified in the Resend dashboard, or the API accepts the
 * call and the mail never arrives — the most expensive failure mode available,
 * because it looks like success. `MAIL_FROM` exists so a staging deploy can
 * send from a domain it actually owns.
 *
 * `no-reply@` rather than `support@`: replies to a verification mail are not
 * read by anyone, and pointing them at the support mailbox would bury the
 * messages that are. The body names the support address for anyone who needs a
 * person.
 */
function fromAddress(): string {
  return process.env.MAIL_FROM ?? `${siteName} <no-reply@fiorematch.com>`;
}

export async function sendWithResend(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<ResendOutcome> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "no_api_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      /**
       * The body is read for the message but never returned to the caller's
       * caller. Resend's errors name the account and the domain, and this
       * string ends up in logs that are not as private as a credential store.
       */
      const detail = await response.text().catch(() => "");
      console.error(`Resend refused a message: ${response.status} ${detail.slice(0, 300)}`);
      return { sent: false, reason: `http_${response.status}` };
    }

    const body = (await response.json()) as { id?: unknown };
    // An accepted call with no id is not a send we can claim happened.
    if (typeof body.id !== "string") return { sent: false, reason: "no_id" };

    return { sent: true, id: body.id };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (!aborted) console.error("Resend request failed", error);
    return { sent: false, reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
