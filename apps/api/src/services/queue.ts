import { Queue } from "bullmq";
import Redis from "ioredis";
import {
  QUEUE_INDEX_REPO,
  QUEUE_FIX_ISSUE,
  type IndexRepoJob,
  type FixIssueJob,
} from "@devmind/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ hard requirement: the connection used by Queue/Worker/QueueEvents must
// disable `maxRetriesPerRequest` (needs to be null) and it's cleaner to also
// disable ready checks. See https://docs.bullmq.io/guide/going-to-production
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("error", (err) => {
  console.error("[queue] redis connection error:", err.message);
});

// One Queue instance per queue name, reused across the process lifetime.
const indexRepoQueue = new Queue<IndexRepoJob>(QUEUE_INDEX_REPO, { connection });
const fixIssueQueue = new Queue<FixIssueJob>(QUEUE_FIX_ISSUE, { connection });

// Default job options — sensible retry policy, no explosive backoff.
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { count: 1000 },  // keep last 1000 for RedisInsight visibility
  removeOnFail: { count: 5000 },
};

export async function enqueueIndexRepo(payload: IndexRepoJob): Promise<string> {
  // jobId = repoId ensures we never enqueue two index jobs for the same repo
  // simultaneously (BullMQ dedupes by jobId).
  const job = await indexRepoQueue.add("index-repo", payload, {
    ...defaultJobOptions,
    jobId: payload.repoId,
  });
  return job.id!;
}

export async function enqueueFixIssue(payload: FixIssueJob): Promise<string> {
  // jobId = jobs.id (already unique per DB row) — guards against duplicate
  // webhook deliveries from GitHub.
  const job = await fixIssueQueue.add("fix-issue", payload, {
    ...defaultJobOptions,
    jobId: payload.jobId,
  });
  return job.id!;
}

// Exposed for graceful shutdown from index.ts.
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([indexRepoQueue.close(), fixIssueQueue.close()]);
  await connection.quit().catch(() => {});
}
