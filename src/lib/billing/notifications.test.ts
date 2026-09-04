import { describe, expect, it } from "vitest";
import { NoNotificationVerifier } from "./notifications";

describe("the default notification verifier", () => {
  /**
   * Throwing rather than returning `null` is the contract, not an accident.
   *
   * `null` means "checked, and the store did not sign this" — a final answer
   * that tells the sender to stop. Having no driver at all is "could not
   * check", which is ours to fix and must stay retryable. A driver author
   * reading this file needs the distinction to be visible before they write
   * the first `return null`.
   */
  it("says it could not check, rather than that the notification was forged", async () => {
    await expect(new NoNotificationVerifier().verify()).rejects.toThrow(
      /no notification verifier/i
    );
  });
});
