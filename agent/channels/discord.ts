import { discordChannel } from "eve/channels/discord";

const credentials = {
  applicationId: () => process.env.DISCORD_APPLICATION_ID ?? "",
  botToken: () => process.env.DISCORD_BOT_TOKEN ?? "",
  publicKey: () => process.env.DISCORD_PUBLIC_KEY ?? "",
};

export default discordChannel({
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
