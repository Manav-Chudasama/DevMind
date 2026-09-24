import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-4o";
const MAX_RETRIES = 3;

/**
 * Coder calls can legitimately take a while on large files, but not minutes.
 * The SDK defaults to a 10-minute timeout, which inside a job pipeline is
 * indistinguishable from a hang — the job just sits in `active` with no output.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90_000);

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — cannot run the agent pipeline");
    }
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0, // we handle retries below so the backoff is visible in logs
    });
  }
  return _client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CompleteArgs<T extends z.ZodType> {
  /** Who is asking — used for the schema name and log prefix. */
  agent: string;
  system: string;
  user: string;
  schema: T;
  /** Lower for judgement calls, higher for code generation. */
  temperature?: number;
}

/**
 * Single entry point for every model call in the pipeline.
 *
 * Uses OpenAI structured outputs (`zodResponseFormat`) rather than prompt-level
 * "please return JSON" instructions, so the response is schema-valid by
 * construction instead of by hope.
 *
 * Note for schema authors: structured outputs require every field to be present.
 * Use `.nullable()` rather than `.optional()` — an absent key is rejected, a null
 * one is not.
 */
export async function complete<T extends z.ZodType>({
  agent,
  system,
  user,
  schema,
  temperature = 0.2,
}: CompleteArgs<T>): Promise<z.infer<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const completion = await client().chat.completions.parse({
        model: LLM_MODEL,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: zodResponseFormat(schema, `${agent}_response`),
      });

      const parsed = completion.choices[0]?.message.parsed;
      if (!parsed) {
        // Almost always a length-cap refusal rather than a malformed body.
        throw new Error(
          `[${agent}] model returned no parsed content (finish_reason: ${completion.choices[0]?.finish_reason})`
        );
      }
      // The SDK's own inference and z.infer resolve to structurally identical
      // types but aren't assignable to each other across the generic boundary.
      return parsed as z.infer<T>;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;
      // Timeouts and connection resets carry no HTTP status but are worth retrying.
      const isTransport =
        err?.name === "APIConnectionTimeoutError" ||
        err?.name === "APIConnectionError";
      const retryable =
        isTransport || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === MAX_RETRIES - 1) throw err;

      const delay = 1000 * 2 ** attempt;
      console.warn(
        `[llm:${agent}] ${status ?? err?.name ?? "error"}, retry ${attempt + 1} in ${delay}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

export { LLM_MODEL };
