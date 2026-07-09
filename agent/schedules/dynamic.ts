import { defineSchedule } from "eve/schedules";
import discord from "../channels/discord.js";
import { scheduleStore } from "#lib/schedule-store.js";

// The one authored schedule. It wakes every minute, atomically claims due
// application-managed rows, and hands each to Discord as a proactive session.
// Delivery is at least once, so side-effecting prompts need their own idempotency.
export default defineSchedule({
  cron: "* * * * *",
  run({ receive, waitUntil }) {
    waitUntil(
      (async () => {
        const jobs = await scheduleStore.claimDue({
          now: new Date(),
          limit: 25,
          leaseForMs: 5 * 60_000,
        });

        await Promise.all(
          jobs.map(async (job) => {
            try {
              await receive(discord, {
                message: job.prompt,
                target: { channelId: job.channelId },
                auth: {
                  principalId: job.ownerId,
                  principalType: "user",
                  authenticator: "discord",
                  attributes: { channel_id: job.channelId },
                },
              });
              await scheduleStore.complete(job);
            } catch (error) {
              await scheduleStore.release(job, {
                error,
                retryAt: new Date(Date.now() + 300_000),
              });
            }
          }),
        );
      })(),
    );
  },
});
