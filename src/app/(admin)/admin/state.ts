/** Shared form state. Kept out of the "use server" module, which may only export functions. */
export type ActionState = { status: "idle" | "success" | "error"; message: string };

export const idleState: ActionState = { status: "idle", message: "" };
