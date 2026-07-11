import { defineSchedule } from "eve/schedules";

// Fire-and-forget task-mode schedule. On Vercel/eve start it fires every 6
// hours; in `eve dev` trigger it by hand with:
//   curl -X POST http://localhost:3000/eve/v1/dev/schedules/heartbeat
export default defineSchedule({
  cron: "0 */6 * * *",
  markdown: [
    "You are running as a scheduled heartbeat task, not a chat turn.",
    "Use bash to append one line to `heartbeat.log` in the working directory:",
    "run `date -u '+%Y-%m-%dT%H:%M:%SZ heartbeat' >> heartbeat.log`.",
    "Then print the file's last line so the run leaves a visible trace.",
  ].join(" "),
});
