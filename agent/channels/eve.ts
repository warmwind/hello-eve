import { httpBasic, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Fail-closed: HTTP Basic callers and the local TUI only. End users can also
// talk to the agent through the Discord channel, which verifies signatures.
export default eveChannel({
  auth: [
    httpBasic({
      username: process.env.ROUTE_AUTH_BASIC_USERNAME!,
      password: process.env.ROUTE_AUTH_BASIC_PASSWORD!,
    }),
    localDev(),
  ],
});
