import { sql } from "../db/client";
import { embedBatch, toVectorLiteral } from "./embedder";
import type { CodeChunk } from "@devmind/shared";

/**
 * Measured against the quantiphi index (63 chunks, text-embedding-3-small):
 *
 *   off-topic control ("how do I bake sourdough bread")  0.147 - 0.181
 *   weakest true positive ("where is state managed")     0.231 - 0.278
 *   typical true positive                                0.35  - 0.65
 *
 * So real signal begins around 0.23 and noise tops out around 0.18. An earlier
 * guess of 0.3 would have returned ZERO results for "where is state managed"
 * even though all three hits were correct.
 *
 * Biased low on purpose: for agents in Phase 4, a missing relevant chunk is far
 * more damaging than an extra irrelevant one the model can ignore. `topK` is the
 * primary limiter; this is only a noise gate.
 */
export const DEFAULT_MIN_SIMILARITY = 0.2;
export const DEFAULT_TOP_K = 5;

/**
 * Cosine-similarity search over one repo's embeddings.
 *
 * Returning fewer than `topK` is correct behaviour — two relevant chunks beat
 * five where three are noise, especially once these are feeding an LLM context
 * window in Phase 4.
 */
export async function retrieveContext(
  query: string,
  repoId: string,
  topK: number = DEFAULT_TOP_K,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY
): Promise<CodeChunk[]> {
  const [queryEmbedding] = await embedBatch([query]);
  if (!queryEmbedding) return [];

  const vec = toVectorLiteral(queryEmbedding);

  // The similarity floor is written inline rather than as `AND similarity > x`:
  // Postgres evaluates WHERE before SELECT aliases exist, so the alias form
  // errors with `column "similarity" does not exist`.
  return sql<CodeChunk[]>`
    SELECT file_path,
           chunk_text,
           1 - (embedding <=> ${vec}::vector) AS similarity
    FROM embeddings
    WHERE repo_id = ${repoId}
      AND 1 - (embedding <=> ${vec}::vector) > ${minSimilarity}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${topK}
  `;
}
