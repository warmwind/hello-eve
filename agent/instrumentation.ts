import { defineInstrumentation } from "eve/instrumentation";
import { registerOTel } from "@vercel/otel";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";

// Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL from the
// environment.
export default defineInstrumentation({
  setup: ({ agentName }) =>
    registerOTel({
      serviceName: agentName,
      spanProcessors: [
        new LangfuseSpanProcessor({
          // Keep Langfuse's default export filter (Langfuse SDK spans, GenAI
          // spans, and known LLM instrumentors), plus eve's own `gen_ai` and
          // `eve` scopes. The `eve` run span parents the GenAI spans so they
          // don't orphan. Everything else — eve's durable-workflow
          // orchestration and the @vercel/otel HTTP spans — is dropped.
          shouldExportSpan: ({ otelSpan }) =>
            isDefaultExportSpan(otelSpan) ||
            ["gen_ai", "eve"].includes(otelSpan.instrumentationScope.name),
        }),
      ],
    }),
});
