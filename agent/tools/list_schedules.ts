import { defineTool } from "eve/tools";
import { z } from "zod";
import { scheduleStore } from "#lib/schedule-store.js";
import { requireScheduleCaller } from "#lib/schedule-owner.js";

export default defineTool({
  description: "List the caller's scheduled reminders and their next run time.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const caller = requireScheduleCaller(ctx);
    return await scheduleStore.list({ ownerId: caller.ownerId });
  },
});
