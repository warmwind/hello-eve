import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_TYPE,
  DISCORD_INTERACTION_TYPE,
  commandInteractionMessage,
  discordChannel,
  parseDiscordInteraction,
  verifyDiscordRequest,
  type DiscordChannel,
} from "eve/channels/discord";
import {
  getDiscordAccessStatus,
  startDiscordAuthorization,
  type DiscordAccessStatus,
} from "../../lib/jinshuju/auth.js";

const credentials = {
  applicationId: () => process.env.DISCORD_APPLICATION_ID ?? "",
  botToken: () => process.env.DISCORD_BOT_TOKEN ?? "",
  publicKey: () => process.env.DISCORD_PUBLIC_KEY ?? "",
};

function accessMessage(
  access: DiscordAccessStatus,
  authorizationUrl: string,
  willResume: boolean,
): string {
  if (access.status === "forbidden") {
    return [
      `⛔ 当前金数据用户 ID：${access.identity.userId}`,
      `当前企业账户：${access.identity.billingAccountName}`,
      "此 Agent 仅限 billing_account.name 为 IM 的用户使用。",
      `如需切换金数据账号，请重新授权：${authorizationUrl}`,
    ].join("\n");
  }
  return [
    "🔐 使用此 Agent 前需要先授权金数据账号。",
    authorizationUrl,
    willResume
      ? "授权完成后会显示当前金数据用户 ID，并自动继续处理当前请求。"
      : "授权完成后会显示当前金数据用户 ID；请随后重新操作当前交互。",
  ].join("\n");
}

function ephemeralResponse(content: string): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
    },
  });
}

const channel = discordChannel({
  credentials,
  onCommand: (_ctx, interaction) => ({
    auth: {
      principalId: interaction.user.id,
      principalType: "user",
      authenticator: "discord",
      attributes: {
        channel_id: interaction.channelId,
        guild_id: interaction.guildId ?? "",
      },
    },
  }),
});

const commandRoute = channel.routes[0];
if (!commandRoute || commandRoute.transport === "websocket") {
  throw new Error("Discord command route is unavailable.");
}
const handleVerifiedCommand = commandRoute.handler;

const gatedRoute = {
  ...commandRoute,
  handler: async (req: Request, args: Parameters<typeof handleVerifiedCommand>[1]) => {
    let rawBody: string;
    try {
      rawBody = await verifyDiscordRequest(req.clone(), {
        publicKey: credentials.publicKey,
      });
    } catch {
      return handleVerifiedCommand(req, args);
    }

    let interaction;
    try {
      interaction = parseDiscordInteraction(JSON.parse(rawBody) as unknown);
    } catch {
      return handleVerifiedCommand(req, args);
    }
    if (!interaction) {
      return handleVerifiedCommand(req, args);
    }

    try {
      const access = await getDiscordAccessStatus(interaction.user.id);
      if (access.status === "authorized") {
        return handleVerifiedCommand(req, args);
      }
      const pendingMessage =
        interaction.type === DISCORD_INTERACTION_TYPE.APPLICATION_COMMAND
          ? commandInteractionMessage(interaction)
          : null;
      const authorizationUrl = await startDiscordAuthorization({
        discordUserId: interaction.user.id,
        discordApplicationId: interaction.applicationId,
        discordInteractionToken: interaction.token,
        discordChannelId: interaction.channelId,
        discordGuildId: interaction.guildId ?? null,
        message: pendingMessage,
      });
      return ephemeralResponse(accessMessage(access, authorizationUrl, pendingMessage !== null));
    } catch (error) {
      console.error("[jinshuju] access gate failed:", error);
      return ephemeralResponse("金数据授权服务暂时不可用，请稍后重试。");
    }
  },
};

export default {
  ...channel,
  routes: [gatedRoute],
} satisfies DiscordChannel;
