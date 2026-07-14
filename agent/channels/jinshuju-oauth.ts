import { defineChannel, GET } from "eve/channels";
import {
  completeDiscordAuthorization,
  type DiscordAuthorizationDelivery,
  type DiscordAuthorizationOutcome,
} from "../../lib/jinshuju/auth.js";

const DISCORD_EPHEMERAL_MESSAGE_FLAG = 64;

function outcomeMessage(outcome: DiscordAuthorizationOutcome): string {
  if (outcome.status === "authorized") {
    return [
      "✅ 金数据授权成功。",
      `当前金数据用户 ID：${outcome.identity.userId}`,
      `当前企业账户：${outcome.identity.billingAccountName}`,
      "现在可以继续使用 Agent，请重新发送刚才的请求。",
    ].join("\n");
  }
  if (outcome.status === "forbidden") {
    return [
      "⛔ 金数据账号已授权，但无权使用此 Agent。",
      `当前金数据用户 ID：${outcome.identity.userId}`,
      `当前企业账户：${outcome.identity.billingAccountName}`,
      "仅 billing_account.name 为 im 的用户可以继续使用。",
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
    GET("/oauth/jinshuju/callback", async (req) => {
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

      const message = outcomeMessage(outcome);
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
