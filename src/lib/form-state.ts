import type { VoteTally } from "./community";

/**
 * Initial states for the public forms. These live outside the "use server"
 * module because such a module may only export async functions.
 */
export type SubscribeState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
  /** What was typed, so a rejected form comes back filled in rather than blank. */
  values?: { firstName?: string; email?: string; country?: string; interests?: string[] };
};

export type VoteState = {
  status: "idle" | "success" | "error";
  message: string;
  choice?: string;
  total: number;
  tallies: VoteTally[];
};

export type IdeaState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
  /** What was written, so a rejected idea is never lost. */
  values?: { body?: string; name?: string; country?: string; email?: string };
};

export const initialSubscribeState: SubscribeState = { status: "idle", message: "" };
export const initialVoteState: VoteState = { status: "idle", message: "", total: 0, tallies: [] };
export const initialIdeaState: IdeaState = { status: "idle", message: "" };
