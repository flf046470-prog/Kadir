import { sendWithResend } from "./resend";

/**
 * Outbound mail.
 *
 * One entry point, so "what can this application send, and to whom" is
 * answerable by grepping for `sendMail` — the same reason `requireUser` is the
 * only way to get a user in a route handler.
 *
 * **Sending is reported, never assumed.** Every caller gets a result it has to
 * look at. The reason is the failure this module exists to avoid: a
 * verification mail that silently does not arrive is indistinguishable, from
 * the member's side, from one they did not receive because they mistyped their
 * address — and indistinguishable, from our side, from a working mailer. So a
 * failure to send is a value, it reaches the registration response, and the UI
 * can offer the resend button instead of telling somebody to check an inbox
 * nothing was sent to.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailResult = { sent: true; id: string } | { sent: false; reason: string };

export type MailProvider = "resend" | "console" | "none";

/**
 * Which driver is active.
 *
 * Resolved from the environment on every call rather than memoised, so a test
 * can set the variable between cases and the answer tracks it.
 *
 * The console driver is the interesting decision. Without it, developing
 * anything that sends mail means either holding a real API key or having no
 * verification link at all, and the second one is what makes people comment out
 * the verification step and forget. With it, `npm run dev` prints the link to
 * the terminal and the flow is exercisable offline.
 *
 * It is confined to non-production by default and cannot be reached by
 * accident: `MAIL_PROVIDER=console` has to be set explicitly to use it where
 * `NODE_ENV` is production. A production deploy with no key sends nothing and
 * says so — the one thing it must never do is quietly log a member's
 * verification link to a server console and report success.
 */
export function mailProvider(): MailProvider {
  const named = process.env.MAIL_PROVIDER;
  if (named === "resend") return "resend";
  if (named === "console") return "console";
  if (named === "none") return "none";

  if (process.env.RESEND_API_KEY) return "resend";
  return process.env.NODE_ENV === "production" ? "none" : "console";
}

/** Whether this deployment can send mail at all. Used by the health endpoint. */
export function mailConfigured(): boolean {
  return mailProvider() !== "none";
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  switch (mailProvider()) {
    case "resend":
      return sendWithResend(message);

    case "console":
      /**
       * `console.info` rather than `console.log`, and the whole text body
       * rather than a summary — the point of this driver is that the
       * verification link is readable in the terminal.
       */
      console.info(
        [
          "",
          "--- mail (console driver, nothing was actually sent) ---",
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          "",
          message.text,
          "-------------------------------------------------------",
          ""
        ].join("\n")
      );
      return { sent: true, id: "console" };

    case "none":
      return { sent: false, reason: "not_configured" };
  }
}
