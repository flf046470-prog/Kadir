import "server-only";

import { getEmailProvider } from "@/lib/config";

/**
 * Thin abstraction over whatever list/transactional provider gets connected
 * later. The default "log" provider writes to the server log so that sign-ups
 * are never silently dropped while no provider is configured.
 */
export type SubscriberPayload = {
  email: string;
  firstName?: string;
  country?: string;
  interests?: string[];
  locale?: string;
  source?: string;
};

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  addSubscriber(payload: SubscriberPayload): Promise<void>;
}

const logProvider: EmailProvider = {
  name: "log",
  configured: false,
  async addSubscriber(payload) {
    // Sign-ups are already stored in the database; this is only the outbound leg.
    console.info("[email] subscriber recorded (no provider configured)", {
      email: maskEmail(payload.email),
      country: payload.country ?? "",
      interests: payload.interests ?? [],
    });
  },
};

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

/**
 * Resend is wired as the first real provider because it needs nothing beyond an
 * API key and an audience id. Any other provider can implement the same
 * interface without touching callers.
 */
function createResendProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim();

  return {
    name: "resend",
    configured: Boolean(apiKey && audienceId),
    async addSubscriber(payload) {
      if (!apiKey || !audienceId) return logProvider.addSubscriber(payload);
      const response = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: payload.email,
          first_name: payload.firstName ?? "",
          unsubscribed: false,
        }),
      });
      if (!response.ok) {
        throw new Error(`Email provider rejected the contact (${response.status})`);
      }
    },
  };
}

export function getEmailService(): EmailProvider {
  return getEmailProvider() === "resend" ? createResendProvider() : logProvider;
}

/** Never lets an outbound failure lose a sign-up that is already stored. */
export async function syncSubscriberSafely(payload: SubscriberPayload): Promise<void> {
  try {
    await getEmailService().addSubscriber(payload);
  } catch (error) {
    console.error("[email] failed to sync subscriber", error);
  }
}
