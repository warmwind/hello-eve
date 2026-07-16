import { localDev, oidc, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Fail-closed: Vercel OIDC callers, Okta-issued bearer tokens, and the local
// TUI only. End users talk to the agent through the Discord channel (which
// verifies request signatures).
export default eveChannel({
  auth: [
    vercelOidc(),
    oidc({
      issuer: process.env.OKTA_ISSUER!,
      audiences: [process.env.OKTA_AUDIENCE!],
    }),
    localDev(),
  ],
});
