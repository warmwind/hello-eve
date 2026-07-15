import { localDev, oidc, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

const oktaIssuer = process.env.OKTA_ISSUER?.replace(/\/+$/, "");
const oktaAudience = process.env.OKTA_AUDIENCE;
const oktaAuth =
  oktaIssuer && oktaAudience
    ? oidc({
        issuer: oktaIssuer,
        audiences: [oktaAudience],
      })
    : null;

// Fail-closed: Vercel workloads, configured Okta callers, and localhost only.
export default eveChannel({
  auth: [vercelOidc(), ...(oktaAuth ? [oktaAuth] : []), localDev()],
});
