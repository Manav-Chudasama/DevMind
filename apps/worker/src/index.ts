import { Worker } from "bullmq";
import Redis from "ioredis";
import {
  QUEUE_INDEX_REPO,
  QUEUE_FIX_ISSUE,
  type IndexRepoJob,
  type FixIssueJob,
} from "@devmind/shared";
import { sql } from "./db/client";
import { handleIndexRepo } from "./queues/indexRepo";
import { handleFixIssue } from "./queues/fixIssue";
import { closeMemory } from "./memory/agentMemory";
import {
  retrieveContext,
  DEFAULT_TOP_K,
  DEFAULT_MIN_SIMILARITY,
} from "./rag/retriever";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8081);
const LOCK_KEY = "devmind:worker:lock";
const LOCK_TTL_S = 20;

// ─── Clients ──────────────────────────────────────────────────────────────────

// Plain connection for the startup ping.
const redis = new Redis(REDIS_URL);

// BullMQ requires its own connection with retries disabled and no ready check.
const bullConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
bullConnection.on("error", (err) =>
  console.error("[worker] bullmq redis error:", err.message)
);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  try {
    await sql`SELECT 1`;
    console.log("[worker] postgres connected");

    await redis.ping();
    console.log("[worker] redis connected");

    // One worker process at a time. bun --watch on Windows has historically
    // left the previous process alive (custom SIGINT + Bun.serve, bun#32400),
    // and two consumers on the same queue with different code is worse than
    // a loud startup failure.
    const locked = await redis.set(LOCK_KEY, String(process.pid), "EX", LOCK_TTL_S, "NX");
    if (locked !== "OK") {
      console.error(
        "[worker] another worker already holds the lock. Stop it with: bun run kill:dev"
      );
      process.exit(1);
    }
    const lockHeartbeat = setInterval(() => {
      redis.expire(LOCK_KEY, LOCK_TTL_S).catch(() => {});
    }, 8_000);
    lockHeartbeat.unref();

    // ── index-repo consumer (Phase 3) ───────────────────────────────────────
    const indexWorker = new Worker<IndexRepoJob>(
      QUEUE_INDEX_REPO,
      (job) => handleIndexRepo(job),
      { connection: bullConnection, concurrency: CONCURRENCY }
    );

    indexWorker.on("completed", (job, result) => {
      console.log(
        `[worker] index-repo ${job.id} completed — ${result.files} files, ${result.chunks} chunks`
      );
    });
    indexWorker.on("failed", (job, err) => {
      console.error(`[worker] index-repo ${job?.id} failed:`, err.message);
    });

    // ── fix-issue consumer (Phase 4) ────────────────────────────────────────
    // Each job runs a full LangGraph pipeline and can make several LLM calls,
    // so concurrency is capped lower than the indexer's to stay clear of
    // OpenAI rate limits.
    const fixConcurrency = Math.max(1, Math.min(CONCURRENCY, 3));
    const fixWorker = new Worker<FixIssueJob>(
      QUEUE_FIX_ISSUE,
      (job) => handleFixIssue(job),
      { connection: bullConnection, concurrency: fixConcurrency }
    );

    fixWorker.on("completed", (job, result) => {
      console.log(
        `[worker] fix-issue ${job.id} ${result.status}` +
          (result.prUrl ? ` — ${result.prUrl}` : "")
      );
    });
    fixWorker.on("failed", (job, err) => {
      console.error(`[worker] fix-issue ${job?.id} failed:`, err.message);
    });

    console.log(
      `[worker] consuming "${QUEUE_INDEX_REPO}" (x${CONCURRENCY}) and ` +
        `"${QUEUE_FIX_ISSUE}" (x${fixConcurrency})`
    );

    // ── HTTP surface ────────────────────────────────────────────────────────
    // /health so the API can check liveness without proxying through Redis.
    // /search so RAG retrieval has exactly one implementation, living next to
    // the embedder rather than duplicated into the API.
    const healthServer = Bun.serve({
      hostname: "127.0.0.1",
      port: HEALTH_PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          return Response.json({ status: "ok", pid: process.pid });
        }

        if (url.pathname === "/search") {
          const q = url.searchParams.get("q");
          const repoId = url.searchParams.get("repoId");
          if (!q || !repoId) {
            return Response.json(
              { error: "missing_params", required: ["q", "repoId"] },
              { status: 400 }
            );
          }

          const topK = Number(url.searchParams.get("k") ?? DEFAULT_TOP_K);
          const minSimilarity = Number(
            url.searchParams.get("minSimilarity") ?? DEFAULT_MIN_SIMILARITY
          );

          try {
            const results = await retrieveContext(q, repoId, topK, minSimilarity);
            return Response.json({ query: q, repoId, count: results.length, results });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[worker] search failed:", message);
            return Response.json({ error: "search_failed", message }, { status: 500 });
          }
        }

        return new Response("not found", { status: 404 });
      },
    });
    console.log(`[worker] http on http://localhost:${healthServer.port} (/health, /search)`);

    // ── Graceful shutdown ───────────────────────────────────────────────────
    const shutdown = async (signal: string) => {
      console.log(`[worker] received ${signal}, shutting down...`);
      try {
        healthServer.stop(true);
        clearInterval(lockHeartbeat);
        await redis.del(LOCK_KEY).catch(() => {});
        // Let in-flight jobs finish before dropping the connection.
        await Promise.allSettled([indexWorker.close(), fixWorker.close()]);
        await closeMemory();
        await bullConnection.quit().catch(() => {});
        await redis.quit().catch(() => {});
        await sql.end({ timeout: 5 });
      } finally {
        process.exit(0);
      }
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("[worker] startup failed:", err);
    process.exit(1);
  }
}

start();
