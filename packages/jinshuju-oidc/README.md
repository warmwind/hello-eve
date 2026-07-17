# @jinshuju/eve-oidc

Jinshuju OIDC route authentication for [Eve](https://github.com/vercel/eve).

```ts
import { jinshujuOidc } from "@jinshuju/eve-oidc";
import { localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

export default eveChannel({
  auth: [jinshujuOidc(), localDev()],
});
```

By default, the verifier checks opaque bearer tokens against
`https://account.jinshuju.net/oauth/userinfo`. Pass a different issuer when
needed:

```ts
jinshujuOidc({ issuer: "https://account.example.com" });
```
