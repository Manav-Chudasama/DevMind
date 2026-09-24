import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/** Keep the recall prompt small — this is injected into every planner call. */
const MAX_NOTES = 10;

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) _redis = new Redis(REDIS_URL);
  return _redis;
}

const key = (repoId: string) => `devmind:memory:${repoId}`;

/**
 * Short episodic memory: one line per resolved issue, per repo.
 *
 * Intentionally a capped list of plain strings rather than embeddings. At this
 * volume a semantic index would be more machinery than the signal justifies;
 * the planner just needs "here is what was done before in this codebase".
 */
export async function recallMemory(repoId: string): Promise<string> {
  const notes = await redis().lrange(key(repoId), 0, MAX_NOTES - 1).catch(() => []);
  if (notes.length === 0) return "";
  return notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
}

export async function rememberFix(repoId: string, note: string): Promise<void> {
  const k = key(repoId);
  await redis()
    .multi()
    .lpush(k, note)
    .ltrim(k, 0, MAX_NOTES - 1)
    .exec()
    .catch((err) => console.error("[memory] write failed:", err?.message));
}

export async function closeMemory(): Promise<void> {
  await _redis?.quit().catch(() => {});
  _redis = null;
}
