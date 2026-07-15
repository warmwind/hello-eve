# hello-eve

The smallest connectable [eve](https://eve.dev) agent: a standard authored
agent folder you can build and talk to locally.

```text
hello-eve/
├── .env                # ANTHROPIC_API_KEY (a DeepSeek key — see agent/agent.ts)
├── package.json
├── tsconfig.json
└── agent/              # eve's nested authored layout
    ├── agent.ts        # model config (DeepSeek via the Anthropic-compatible API)
    ├── instructions.md # the always-on system prompt
    ├── sandbox.ts      # just-bash execution backend
    └── channels/
        └── eve.ts      # HTTP/NDJSON channel, no auth (local dev only)
```

## Model / external calls

`agent/agent.ts` points the Anthropic client at DeepSeek's Anthropic-compatible
endpoint (`https://api.deepseek.com/anthropic`), which reads `ANTHROPIC_API_KEY`.
So the key in `.env` is a **DeepSeek** key, and that is what lets the agent make
outbound model calls. Swap the `baseURL`/model for real Anthropic if you prefer.

## Run

```bash
pnpm install
pnpm dev          # eve dev — starts the local agent server + TUI
```

Then talk to it over the eve channel (default dev server on port 3000):

```bash
curl -X POST http://localhost:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Reply with exactly: pong"}'
```

## Okta OIDC route-auth test

The `/oidc-test` page is a browser-only test harness for Eve's inbound route
authentication. It uses Okta Authorization Code with PKCE to obtain an access
token, then sends that token as `Authorization: Bearer ...` to
`POST /eve/v1/session`. The agent validates the JWT with Eve's built-in
`oidc()` verifier before model execution.

1. Create an Okta Integrator Free Plan org and use the `default` Custom
   Authorization Server. Its default audience is normally `api://default`.
2. Create an OIDC **Single-Page Application** with Authorization Code and PKCE.
3. Register `<deployment-origin>/auth/oidc/callback` as a sign-in redirect URI.
   For local testing, also register
   `http://localhost:3000/auth/oidc/callback`.
4. Add each test origin as an Okta Trusted Origin with CORS enabled so the page
   can call the token and UserInfo endpoints.
5. Set `OKTA_ISSUER`, `OKTA_CLIENT_ID`, and `OKTA_AUDIENCE` in Vercel, redeploy,
   then open `<deployment-origin>/oidc-test`.

The page keeps the access token in `sessionStorage`, so closing its browser tab
clears the test credential. On a deployed URL, the anonymous test should return
401 and the authenticated test should start an Eve session. Localhost remains
open through `localDev()`, so the anonymous button does not prove rejection
when testing locally.

## Workflow world

This project uses eve's built-in **local** world, so no database is required —
state is in-process and resets when the agent restarts. To make workflows
durable, add `experimental.workflow.world: "@workflow/world-postgres"` to
`agent/agent.ts`, add the `@workflow/world-postgres` dependency, and set
`WORKFLOW_POSTGRES_URL` to a reachable Postgres.
