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

export interface EnqueueResult {
  jobId: string;
  /** False when an equivalent job was already queued or running. */
  enqueued: boolean;
}

export async function enqueueIndexRepo(
  payload: IndexRepoJob
): Promise<EnqueueResult> {
  // jobId = repoId dedupes concurrent index runs for the same repo. The catch
  // is that a *finished* job (completed or failed) keeps occupying that id and
  // silently blocks re-adding, so a retry would look like it worked and never
  // run. Clear the terminal job first; leave in-flight ones alone.
  const existing = await indexRepoQueue.getJob(payload.repoId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      return { jobId: existing.id!, enqueued: false };
    }
    await existing.remove().catch(() => {});
  }

  const job = await indexRepoQueue.add("index-repo", payload, {
    ...defaultJobOptions,
    jobId: payload.repoId,
  });
  return { jobId: job.id!, enqueued: true };
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

export async function getQueueStats() {
  const [indexCounts, fixCounts] = await Promise.all([
    indexRepoQueue.getJobCounts("active", "waiting", "completed", "failed"),
    fixIssueQueue.getJobCounts("active", "waiting", "completed", "failed"),
  ]);

  return {
    indexRepo: {
      active: indexCounts.active ?? 0,
      waiting: indexCounts.waiting ?? 0,
      completed: indexCounts.completed ?? 0,
      failed: indexCounts.failed ?? 0,
    },
    fixIssue: {
      active: fixCounts.active ?? 0,
      waiting: fixCounts.waiting ?? 0,
      completed: fixCounts.completed ?? 0,
      failed: fixCounts.failed ?? 0,
    },
  };
}

// Exposed for graceful shutdown from index.ts.
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([indexRepoQueue.close(), fixIssueQueue.close()]);
  await connection.quit().catch(() => {});
}
