import Anthropic from "@anthropic-ai/sdk";
import { OLLAMA_MODEL, ollamaStructured, OllamaUnavailableError } from "./ollama";

/**
 * Thin wrapper over the Anthropic SDK, and the one place a provider is chosen.
 *
 * Everything Rolexa asks a model for is structured, so every call here goes
 * through `output_config.format` with a JSON schema and comes back as a parsed
 * object. Calls stream and use `.finalMessage()` so a long extraction can't hit
 * an HTTP timeout.
 *
 * A local model can serve the same contract — see `ollama.ts` — so `structured`
 * dispatches on `provider()`. Callers record `modelTag()` next to whatever they
 * generated, because "which model wrote this" is user-visible information.
 */

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/** Server-side refusal fallbacks are a Claude API feature on the 5-series. */
const SUPPORTS_FALLBACKS = /^claude-(opus-5|fable-5|mythos-5)/.test(MODEL);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export type Provider = "claude" | "ollama" | "none";

/**
 * Claude wins when a key is present; a configured local model is the fallback.
 * With neither, every caller uses its deterministic path instead.
 */
export function provider(): Provider {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (OLLAMA_MODEL) return "ollama";
  return "none";
}

/** Is any model available, or is this a rules-only run? */
export function hasModel(): boolean {
  return provider() !== "none";
}

/** Stored alongside generated data so the UI can say what produced it. */
export function modelTag(): "claude" | "ollama" {
  return provider() === "claude" ? "claude" : "ollama";
}

/** Human-readable identity of the model in use, for the overview page. */
export function modelName(): string {
  return provider() === "claude" ? MODEL : OLLAMA_MODEL;
}

function getClient(): Anthropic {
  if (!client) {
    // Reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the env.
    client = new Anthropic({ maxRetries: 2 });
  }
  return client;
}

export class ClaudeRefusalError extends Error {
  constructor(public category: string | null) {
    super(
      `Claude declined this request${category ? ` (${category})` : ""}. ` +
        `Nothing was generated.`,
    );
    this.name = "ClaudeRefusalError";
  }
}

export class ClaudeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeUnavailableError";
  }
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type StructuredCall = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: Effort;
};

/**
 * Run one structured request and return the parsed JSON object.
 *
 * The 5-series can decline a request outright (HTTP 200, `stop_reason:
 * "refusal"`), so `stop_reason` is checked before `content` is read.
 */
export async function structured<T>({
  system,
  user,
  schema,
  maxTokens = 32000,
  effort = "medium",
}: StructuredCall): Promise<T> {
  if (provider() === "none") {
    throw new ClaudeUnavailableError("No model is configured (ANTHROPIC_API_KEY or OLLAMA_MODEL)");
  }
  if (provider() === "ollama") {
    return ollamaStructured<T>({ system, user, schema, maxTokens });
  }

  const message = await runWithFallbacks({ system, user, schema, maxTokens, effort });

  if (message.stopReason === "refusal") {
    throw new ClaudeRefusalError(message.refusalCategory);
  }
  if (message.stopReason === "max_tokens") {
    throw new Error(
      "Claude hit the output token limit before finishing. The CV or job " +
        "description may be unusually long — try splitting it.",
    );
  }
  if (!message.text) throw new Error("Claude returned no text content.");

  try {
    return JSON.parse(message.text) as T;
  } catch {
    throw new Error("Claude returned output that was not valid JSON.");
  }
}

/**
 * Issue the request with server-side refusal fallbacks when the model supports
 * them, falling back to the plain endpoint if the API rejects the beta.
 *
 * Streaming (rather than a plain create) keeps a long extraction from tripping
 * the SDK's request timeout at these `max_tokens` values.
 */
type Outcome = {
  /** First text block, if the response produced one. */
  text: string | undefined;
  stopReason: string | null;
  refusalCategory: string | null;
};

async function runWithFallbacks(call: Required<StructuredCall>): Promise<Outcome> {
  const c = getClient();
  const shared = {
    model: MODEL,
    max_tokens: call.maxTokens,
    system: call.system,
    messages: [{ role: "user" as const, content: call.user }],
  };
  const format = { type: "json_schema" as const, schema: call.schema };

  if (SUPPORTS_FALLBACKS) {
    try {
      const message = await c.beta.messages
        .stream({
          ...shared,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: call.effort, format },
        })
        .finalMessage();
      return {
        text: message.content.find((b) => b.type === "text")?.text,
        stopReason: message.stop_reason,
        refusalCategory: message.stop_details?.category ?? null,
      };
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      // Org or API version without the fallback beta — retry plainly.
    }
  }

  const message = await c.messages
    .stream({ ...shared, output_config: { effort: call.effort, format } })
    .finalMessage();

  return {
    text: message.content.find((b) => b.type === "text")?.text,
    stopReason: message.stop_reason,
    refusalCategory: message.stop_details?.category ?? null,
  };
}

/** Turn SDK errors into something worth showing a user. */
export function describeClaudeError(err: unknown): string {
  if (err instanceof ClaudeRefusalError) return err.message;
  if (err instanceof ClaudeUnavailableError) return err.message;
  if (err instanceof OllamaUnavailableError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY was rejected. Check the key in .env.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `This API key cannot use ${MODEL}.`;
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Model "${MODEL}" was not found. Check ANTHROPIC_MODEL in .env.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Claude API. Try again shortly.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API. Check your network connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API error (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* JSON-schema helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Structured outputs require `additionalProperties: false` and every property
 * listed in `required`. This builder enforces both so a schema can't silently
 * drift out of spec.
 */
export function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function arr(items: unknown) {
  return { type: "array", items };
}

export function str(description?: string) {
  return description ? { type: "string", description } : { type: "string" };
}

export function strEnum(values: string[], description?: string) {
  return description
    ? { type: "string", enum: values, description }
    : { type: "string", enum: values };
}

export function strArr(description?: string) {
  return description
    ? { type: "array", items: { type: "string" }, description }
    : { type: "array", items: { type: "string" } };
}
