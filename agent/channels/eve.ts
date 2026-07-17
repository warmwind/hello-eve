import { localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { jinshujuOidc } from "@jinshuju/eve-oidc";

// Fail-closed: Jinshuju UAT users and the local TUI only. End users can also
// talk to the agent through the Discord channel, which verifies signatures.
export default eveChannel({
  auth: [
    jinshujuOidc({ issuer: "https://account.uat.jinshuju.net" }),
    localDev(),
  ],
});
