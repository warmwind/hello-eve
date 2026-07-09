import { defineTool } from "eve/tools";
import { z } from "zod";
import { scheduleStore } from "#lib/schedule-store.js";
import { requireScheduleCaller } from "#lib/schedule-owner.js";

export default defineTool({
  description:
    "Schedule a one-time or repeating proactive message to the user, delivered to the Discord channel the request came from. firstRunAt is ISO 8601 with an explicit offset. Use everyMinutes for repeating work and null for a one-time reminder.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(8000)
      .describe("What the agent should do/say when the schedule fires."),
    firstRunAt: z
      .string()
      .datetime({ offset: true })
      .describe("First run time, ISO 8601 with offset, e.g. 2026-07-09T14:30:00+08:00"),
    everyMinutes: z.number().int().min(1).max(525600).nullable().default(null),
  }),
  async execute(input, ctx) {
    // Delivery target comes from the authenticated session, never the model,
    // so a caller can't schedule messages into a channel they don't own.
    const caller = requireScheduleCaller(ctx);
    const channelId = caller.channelId;
    if (!channelId) {
      throw new Error("The caller is not on a Discord channel, so there is nowhere to deliver.");
    }
    const row = await scheduleStore.create(
      { ownerId: caller.ownerId },
      {
        prompt: input.prompt,
        channelId,
        firstRunAt: new Date(input.firstRunAt),
        everyMinutes: input.everyMinutes,
      },
    );
    return {
      id: row.id,
      nextRunAt: row.nextRunAt,
      everyMinutes: row.everyMinutes,
      channelId: row.channelId,
    };
  },
});
