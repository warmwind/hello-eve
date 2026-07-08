import { none } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Local dev only: no auth. A real deployment puts auth in front of this.
export default eveChannel({
  auth: [none()],
});
