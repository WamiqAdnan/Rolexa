/**
 * Local-model provider.
 *
 * Rolexa's structured calls are provider-shaped, not Claude-shaped: a system
 * prompt, a user prompt and a JSON schema in, a parsed object out. Ollama can
 * satisfy the same contract — its `format` field takes a JSON schema and
 * constrains decoding to it — so the schemas in `extract/schema.ts` and
 * `job-match.ts` are reused unchanged.
 *
 * This path exists so the whole pipeline can run on a machine with no API key
 * and no network. It is slower and less accurate than Claude; the model that
 * produced a result is recorded alongside it so the UI can say which ran.
 */

const HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");

/** Configured local model, e.g. `qwen3:8b`. Empty when the provider is off. */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "";

/**
 * Context window to run with. Ollama defaults to a small window that silently
 * truncates a long CV, which would look like a bad extraction rather than a
 * configuration problem.
 */
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 16384);

/** A local generation is minutes, not seconds, so the usual HTTP timeouts don't apply. */
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20 * 60 * 1000);

/**
 * Hard ceiling on generated tokens, whatever the caller asks for.
 *
 * Callers size `maxTokens` for a frontier model. A small local model under a
 * large JSON schema can instead loop — emitting array entries and never closing
 * the array — and at ~20 tokens/s a 32k budget is half an hour of nothing. A CV
 * extraction that behaves finishes in about 5k tokens, so this cuts a runaway
 * off early and lets the caller fall back to its deterministic path.
 */
const MAX_PREDICT = Number(process.env.OLLAMA_MAX_PREDICT || 12000);

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

type OllamaCall = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
};

type ChatChunk = {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
};

/** Run one structured request against the local model and return parsed JSON. */
export async function ollamaStructured<T>({
  system,
  user,
  schema,
  maxTokens,
}: OllamaCall): Promise<T> {
  const body = {
    model: OLLAMA_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Streamed for the same reason the Claude path streams: a local extraction
    // runs for minutes, and a single unanswered request trips Node's 300s
    // header timeout long before the model is finished.
    stream: true,
    // Reasoning models otherwise spend the output budget thinking, and the
    // schema constraint then applies to prose rather than to the answer.
    think: false,
    format: schema,
    options: {
      temperature: 0.2,
      num_ctx: NUM_CTX,
      num_predict: Math.min(maxTokens, MAX_PREDICT),
    },
  };

  let res: Response;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${HOST} (${detail}). Is \`ollama serve\` running?`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 404) {
      throw new OllamaUnavailableError(
        `Ollama has no model "${OLLAMA_MODEL}". Run \`ollama pull ${OLLAMA_MODEL}\`.`,
      );
    }
    throw new Error(`Ollama error (${res.status}): ${detail}`);
  }

  const { content, doneReason } = await readStream(res);

  if (doneReason === "length") {
    throw new Error(
      `${OLLAMA_MODEL} hit the output token limit before finishing. The CV or ` +
        `job description may be unusually long — try splitting it.`,
    );
  }

  const text = stripNonJson(content);
  if (!text) throw new Error(`${OLLAMA_MODEL} returned no content.`);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${OLLAMA_MODEL} returned output that was not valid JSON.`);
  }
}

/**
 * Ollama streams newline-delimited JSON, one object per token batch, with the
 * last one carrying `done`. Concatenating `message.content` reassembles the
 * answer.
 */
async function readStream(res: Response): Promise<{ content: string; doneReason?: string }> {
  if (!res.body) throw new Error("Ollama returned no response body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let doneReason: string | undefined;

  const take = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed) as ChatChunk;
    if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
    content += chunk.message?.content ?? "";
    if (chunk.done) doneReason = chunk.done_reason;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line);
  }
  take(buffer);

  return { content, doneReason };
}

/**
 * Constrained decoding gives clean JSON, but a model that ignores `think:
 * false` or wraps its answer in a fence would otherwise fail to parse for a
 * reason that has nothing to do with the content.
 */
function stripNonJson(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);

  return text.trim();
}
