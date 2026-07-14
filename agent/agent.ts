import { createAnthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

// DeepSeek exposes an Anthropic-compatible endpoint that reads ANTHROPIC_API_KEY,
// so the key in .env is a DeepSeek key, not an Anthropic one.
const deepseekAnthropic = createAnthropic({
  baseURL: "https://api.deepseek.com/anthropic",
});

export default defineAgent({
  // DeepSeek maps claude-sonnet* model names onto its own model.
  model: deepseekAnthropic("claude-sonnet-4-5"),
  modelContextWindowTokens: 200_000,
  experimental: {
    // The Postgres world is for self-hosting only: WORKFLOW_POSTGRES_URL is a
    // local tunnel cloud runtimes cannot reach. On Vercel, leaving `world`
    // unset selects the managed Vercel Workflow.
    ...(process.env.VERCEL
      ? {}
      : { workflow: { world: "@workflow/world-postgres" } }),
  },
});
