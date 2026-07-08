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

## Workflow world

This project uses eve's built-in **local** world, so no database is required —
state is in-process and resets when the agent restarts. To make workflows
durable, add `experimental.workflow.world: "@workflow/world-postgres"` to
`agent/agent.ts`, add the `@workflow/world-postgres` dependency, and set
`WORKFLOW_POSTGRES_URL` to a reachable Postgres.
