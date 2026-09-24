import express from "express";
import postgres from "postgres";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 8080;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKER_HEALTH_URL =
  process.env.WORKER_HEALTH_URL ?? "http://localhost:8081/health";

// ─── DB + Redis clients ───────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { max: 5 });
const redis = new Redis(REDIS_URL, { lazyConnect: true });

// ─── Routes ───────────────────────────────────────────────────────────────────

// Timeout helper — keeps ioredis's silent offline queue from hanging us
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

app.get("/health", async (_req, res) => {
  // Check each dependency independently so one failure doesn't hide the others
  const postgres = await withTimeout(
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
    status: "ok", // API itself is up if we reached this line
    postgres,
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

    app.listen(PORT, () => {
      console.log(`[api] listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[api] startup failed:", err);
    process.exit(1);
  }
}

start();
