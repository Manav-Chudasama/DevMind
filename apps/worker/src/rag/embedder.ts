import OpenAI from "openai";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

/** Must match the `vector(1536)` column in schema.sql. */
export const EMBEDDING_DIMENSIONS = 1536;

/** OpenAI accepts 100 inputs per embeddings request comfortably. */
export const EMBED_BATCH_SIZE = 100;

/**
 * text-embedding-3-small rejects any single input over 8191 tokens, and one
 * oversized input fails the WHOLE batch. 7500 tokens at ~3 chars/token for code
 * gives us a margin. A char estimate is deliberate here — pulling in tiktoken
 * just for a safety valve isn't worth the dependency.
 *
 * If the chunker is behaving, this never fires. That's precisely why it exists:
 * chunker bugs are silent, and this failure mode is loud and expensive.
 */
const MAX_INPUT_CHARS = 7500 * 3;

const MAX_RETRIES = 5;

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — cannot embed");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function truncate(text: string): string {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embeds one batch (expects <= EMBED_BATCH_SIZE inputs). Retries on 429 and 5xx
 * with exponential backoff. Returned vectors are in the same order as `texts`.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const input = texts.map(truncate);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await client().embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      });
      // The API preserves input order, but sort by index defensively.
      return res.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === MAX_RETRIES - 1) throw err;

      const delay = 1000 * 2 ** attempt;
      console.warn(
        `[embedder] ${status} on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Embeds an arbitrary number of texts, chunked into API-sized batches. */
export async function embedAll(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    out.push(...(await embedBatch(batch)));
    onProgress?.(Math.min(i + EMBED_BATCH_SIZE, texts.length), texts.length);
  }
  return out;
}

/** pgvector's text input format: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
