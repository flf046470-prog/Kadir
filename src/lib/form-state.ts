import type { VoteTally } from "./community";

/**
 * Initial states for the public forms. These live outside the "use server"
 * module because such a module may only export async functions.
 */
export type SubscribeState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
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
};

export const initialSubscribeState: SubscribeState = { status: "idle", message: "" };
export const initialVoteState: VoteState = { status: "idle", message: "", total: 0, tallies: [] };
export const initialIdeaState: IdeaState = { status: "idle", message: "" };
