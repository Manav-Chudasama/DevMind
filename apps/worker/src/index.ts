import postgres from "postgres";
import Redis from "ioredis";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

// ─── Clients ──────────────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { max: CONCURRENCY + 1 });
const redis = new Redis(REDIS_URL);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  try {
    await sql`SELECT 1`;
    console.log("[worker] postgres connected");

    await redis.ping();
    console.log("[worker] redis connected");

    console.log(
      `[worker] ready — concurrency: ${CONCURRENCY} | waiting for jobs (BullMQ consumers added in Phase 2)`
    );

    // Keep process alive — BullMQ consumers will be registered here in Phase 2
    setInterval(() => {}, 1 << 30);
  } catch (err) {
    console.error("[worker] startup failed:", err);
    process.exit(1);
  }
}

start();
