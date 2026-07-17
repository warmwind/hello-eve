import assert from "node:assert/strict";
import test from "node:test";
import { jinshujuOidc } from "../dist/index.js";

const defaultIssuer = "https://account.jinshuju.net";

test("jinshujuOidc authenticates an opaque access token through UserInfo", async (t) => {
  let userInfoRequest;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    userInfoRequest = { input, init };
    return Response.json({
      sub: "user-42",
      name: "Alice",
      current_account: "IM",
      roles: ["admin"],
      ignored_number: 42,
    });
  });

  const authenticate = jinshujuOidc();
  const sessionAuth = await authenticate(
    new Request("https://hello-eve.agent.example/eve/v1/session", {
      headers: { authorization: "Bearer opaque-access-token" },
    }),
  );

  assert.deepEqual(sessionAuth, {
    attributes: {
      current_account: "IM",
      name: "Alice",
      roles: ["admin"],
    },
    authenticator: "oidc",
    issuer: defaultIssuer,
    principalId: `${defaultIssuer}:user-42`,
    principalType: "user",
    subject: "user-42",
  });
  assert.equal(userInfoRequest.input, `${defaultIssuer}/oauth/userinfo`);
  const headers = new Headers(userInfoRequest.init.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer opaque-access-token");
});

test("jinshujuOidc skips missing and rejected bearer credentials", async (t) => {
  const issuer = "https://account.example.com";
  let requestCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requestCount += 1;
    return new Response(null, { status: 401 });
  });

  const authenticate = jinshujuOidc({ issuer });
  assert.equal(
    await authenticate(new Request("https://hello-eve.agent.example/eve/v1/session")),
    null,
  );
  assert.equal(requestCount, 0);

  assert.equal(
    await authenticate(
      new Request("https://hello-eve.agent.example/eve/v1/session", {
        headers: { authorization: "Bearer rejected-token" },
      }),
    ),
    null,
  );
  assert.equal(requestCount, 1);
});
