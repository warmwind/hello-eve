import { discordChannel } from "eve/channels/discord";

// Outbound bot-token calls (typing + proactive channel posts) read botToken
// ONLY from the channel's `credentials` — eve does not fall back to
// DISCORD_BOT_TOKEN here (the env fallback only covers inbound verification).
// Passing lazy functions defers the env read to call time, so it works
// regardless of when dotenv populates process.env.
export default discordChannel({
  credentials: {
    applicationId: () => process.env.DISCORD_APPLICATION_ID ?? "",
    botToken: () => process.env.DISCORD_BOT_TOKEN ?? "",
    publicKey: () => process.env.DISCORD_PUBLIC_KEY ?? "",
  },
  // channel_id is carried into auth attributes so create_schedule can record
  // where a proactive reminder should be delivered later.
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
