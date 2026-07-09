import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { scheduleStore } from "#lib/schedule-store.js";
import { requireScheduleCaller } from "#lib/schedule-owner.js";

export default defineTool({
  description: "Delete one of the caller's scheduled reminders by id.",
  inputSchema: z.object({ id: z.string().uuid() }),
  approval: always(),
  async execute({ id }, ctx) {
    const caller = requireScheduleCaller(ctx);
    return { deleted: await scheduleStore.delete({ ownerId: caller.ownerId }, id) };
  },
});
