import { defineChannel, GET } from "eve/channels";
import {
  completeDiscordAuthorization,
  type DiscordAuthorizationDelivery,
  type DiscordAuthorizationOutcome,
} from "../../lib/jinshuju/auth.js";
import discord from "./discord.js";

const DISCORD_EPHEMERAL_MESSAGE_FLAG = 64;

function outcomeMessage(
  outcome: DiscordAuthorizationOutcome,
  resumeStatus: "not_requested" | "started" | "failed",
): string {
  if (outcome.status === "authorized") {
    return [
      "✅ 金数据授权成功。",
      `当前金数据用户 ID：${outcome.identity.userId}`,
      `当前企业账户：${outcome.identity.billingAccountName}`,
      resumeStatus === "started"
        ? "已恢复原消息，正在继续处理。"
        : resumeStatus === "failed"
          ? "自动继续处理原消息失败，请返回 Discord 后重试。"
          : "现在可以继续使用 Agent。",
    ].join("\n");
  }
  if (outcome.status === "forbidden") {
    return [
      "⛔ 金数据账号已授权，但无权使用此 Agent。",
      `当前金数据用户 ID：${outcome.identity.userId}`,
      `当前企业账户：${outcome.identity.billingAccountName}`,
      "仅 billing_account.name 为 IM 的用户可以继续使用。",
    ].join("\n");
  }
  return `金数据授权失败（${outcome.reason}），请返回 Discord 后重试。`;
}

async function postDiscordFollowup(
  delivery: DiscordAuthorizationDelivery,
  content: string,
): Promise<void> {
  const baseUrl = (process.env.DISCORD_API_BASE_URL ?? "https://discord.com/api/v10").replace(
    /\/+$/,
    "",
  );
  const url = `${baseUrl}/webhooks/${encodeURIComponent(delivery.applicationId)}/${encodeURIComponent(delivery.interactionToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content,
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    console.error(`[jinshuju] Discord OAuth followup returned ${res.status}.`);
  }
}

export default defineChannel({
  routes: [
    GET("/oauth/jinshuju/callback", async (req, args) => {
      const url = new URL(req.url);
      let outcome: DiscordAuthorizationOutcome;
      try {
        outcome = await completeDiscordAuthorization({
          code: url.searchParams.get("code"),
          state: url.searchParams.get("state"),
          error: url.searchParams.get("error"),
        });
      } catch (error) {
        console.error("[jinshuju] invalid OAuth callback:", error);
        return new Response("金数据授权链接无效、已过期或已使用，请返回 Discord 后重试。", {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      let resumeStatus: "not_requested" | "started" | "failed" = "not_requested";
      if (outcome.status === "authorized" && outcome.resume.message) {
        try {
          await args.receive(discord, {
            message: outcome.resume.message,
            target: { channelId: outcome.resume.channelId },
            auth: {
              principalId: outcome.resume.discordUserId,
              principalType: "user",
              authenticator: "discord",
              attributes: {
                channel_id: outcome.resume.channelId,
                guild_id: outcome.resume.guildId ?? "",
              },
            },
          });
          resumeStatus = "started";
        } catch (error) {
          console.error("[jinshuju] failed to resume Discord message:", error);
          resumeStatus = "failed";
        }
      }
      const message = outcomeMessage(outcome, resumeStatus);
      try {
        await postDiscordFollowup(outcome.delivery, message);
      } catch (error) {
        console.error("[jinshuju] Discord OAuth followup failed:", error);
      }
      return new Response(message, {
        status:
          outcome.status === "authorized" ? 200 : outcome.status === "forbidden" ? 403 : 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }),
  ],
});
