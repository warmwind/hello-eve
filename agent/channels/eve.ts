import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Fail-closed: local TUI and Vercel OIDC callers only. End users talk to the
// agent through the Discord channel (which verifies request signatures).
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
