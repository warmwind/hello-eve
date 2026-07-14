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

## Jinshuju (金数据) access gate

Every Discord user must authorize a Jinshuju account before the agent handles
their request. OAuth runs against `account.jinshuju.net`; after the callback,
the agent reads the current identity from Jinshuju's REST API and grants access
only when `billing_account.name` is `IM`.

How the flow works:

1. The Discord command gate checks the caller's stored authorization. A new or
   expired authorization makes the agent return only a private sign-in link
   generated with PKCE S256.
2. The user signs in on account.jinshuju.net and consents. The provider
   redirects to the registered `/oauth/jinshuju/callback` route.
3. The callback exchanges the code, calls `GET /api/v1/me` and
   `GET /api/v1/billing_account`, and stores the user-scoped result in
   Postgres. Discord and the browser both display the current Jinshuju user ID.
   Users outside the `IM` billing account remain blocked.

Setup:

1. Register an application on account.jinshuju.net (`/oauth/applications`,
   needs an oauth-admin account): redirect_uri
   `<public base URL>/oauth/jinshuju/callback`, scopes `public users`.
2. Fill `JINSHUJU_CLIENT_ID`, `JINSHUJU_CLIENT_SECRET`,
   `JINSHUJU_REDIRECT_URI`, and a reachable Postgres URL in `.env` (see
   `.env.example`).

Scope changes are handled automatically: a stored token granted under a
narrower scope set than `JINSHUJU_OAUTH_SCOPES` triggers a fresh consent
instead of allowing the request through.

## Workflow world

This project uses eve's built-in **local** world, so no database is required —
state is in-process and resets when the agent restarts. To make workflows
durable, add `experimental.workflow.world: "@workflow/world-postgres"` to
`agent/agent.ts`, add the `@workflow/world-postgres` dependency, and set
`WORKFLOW_POSTGRES_URL` to a reachable Postgres.
