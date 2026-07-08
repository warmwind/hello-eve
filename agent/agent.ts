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
});
