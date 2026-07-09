import type { SessionContext } from "eve/context";

export interface ScheduleCaller {
  ownerId: string;
  /** Discord channel the request came from, when the caller is on Discord. */
  channelId: string | null;
}

// Identity comes from the authenticated session, never from the model.
export function requireScheduleCaller(ctx: SessionContext): ScheduleCaller {
  const auth = ctx.session.auth.current;
  if (!auth || auth.principalType !== "user") {
    throw new Error("An authenticated user is required to manage schedules.");
  }
  const channelId = auth.attributes.channel_id;
  return {
    ownerId: auth.principalId,
    channelId: typeof channelId === "string" ? channelId : null,
  };
}
