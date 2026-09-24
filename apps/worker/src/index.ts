import { Worker } from "bullmq";
import Redis from "ioredis";
import { QUEUE_INDEX_REPO, type IndexRepoJob } from "@devmind/shared";
import { sql } from "./db/client";
import { handleIndexRepo } from "./queues/indexRepo";
import {
  retrieveContext,
  DEFAULT_TOP_K,
  DEFAULT_MIN_SIMILARITY,
} from "./rag/retriever";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8081);

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

    // ── index-repo consumer (Phase 3) ───────────────────────────────────────
    // fix-issue stays unconsumed until Phase 4 ships the agent pipeline.
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

    console.log(
      `[worker] consuming "${QUEUE_INDEX_REPO}" — concurrency: ${CONCURRENCY}`
    );

    // ── HTTP surface ────────────────────────────────────────────────────────
    // /health so the API can check liveness without proxying through Redis.
    // /search so RAG retrieval has exactly one implementation, living next to
    // the embedder rather than duplicated into the API.
    const healthServer = Bun.serve({
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
        // Let in-flight jobs finish before dropping the connection.
        await indexWorker.close();
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
