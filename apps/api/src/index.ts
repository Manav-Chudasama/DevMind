import express from "express";
import Redis from "ioredis";
import { sql } from "./db/client";
import { closeQueues } from "./services/queue";
import reposRouter from "./routes/repos";
import jobsRouter from "./routes/jobs";
import webhookRouter from "./routes/webhook";

const PORT = process.env.PORT ?? 8080;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKER_HEALTH_URL =
  process.env.WORKER_HEALTH_URL ?? "http://localhost:8081/health";

// Redis client used *only* by /health. Kept separate from BullMQ's connection
// so a slow health probe never blocks queue ops (and vice versa).
const redis = new Redis(REDIS_URL, { lazyConnect: true });

const app = express();

// ─── Route mounting order matters ─────────────────────────────────────────────
// The webhook receiver must see the RAW body so it can verify the HMAC over the
// exact bytes GitHub signed. Global express.json() is mounted AFTER so it only
// applies to the JSON API routes below.
app.use(
  "/api/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  webhookRouter
);
app.use(express.json());
app.use("/api/repos", reposRouter);
app.use("/api/jobs", jobsRouter);

// ─── Health ───────────────────────────────────────────────────────────────────

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

app.get("/health", async (_req, res) => {
  const postgresStatus = await withTimeout(
    sql`SELECT 1`.then(() => "up" as const).catch(() => "down" as const),
    1500,
    "down" as const
  );

  const redisStatus = await withTimeout(
    redis
      .ping()
      .then((p) => (p === "PONG" ? ("up" as const) : ("down" as const)))
      .catch(() => "down" as const),
    1000,
    "down" as const
  );

  // Worker health — ping the worker's own HTTP endpoint. Independent of Redis;
  // if the worker process is dead, the socket refuses instantly.
  const worker = await withTimeout(
    fetch(WORKER_HEALTH_URL, { signal: AbortSignal.timeout(800) })
      .then((r) => (r.ok ? ("up" as const) : ("down" as const)))
      .catch(() => "down" as const),
    1000,
    "down" as const
  );

  res.json({
    status: "ok",
    postgres: postgresStatus,
    redis: redisStatus,
    worker,
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  try {
    await sql`SELECT 1`;
    console.log("[api] postgres connected");

    await redis.connect();
    console.log("[api] redis connected");

    const server = app.listen(PORT, () => {
      console.log(`[api] listening on http://localhost:${PORT}`);
    });

    // Graceful shutdown — close HTTP listener, then queues, then DB/Redis.
    const shutdown = async (signal: string) => {
      console.log(`[api] received ${signal}, shutting down...`);
      server.close();
      await closeQueues();
      await redis.quit().catch(() => {});
      await sql.end({ timeout: 5 });
      process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("[api] startup failed:", err);
    process.exit(1);
  }
}

start();
