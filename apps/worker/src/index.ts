import postgres from "postgres";
import Redis from "ioredis";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8081);

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

    // Health server — API pings this directly so worker liveness is not proxied
    // through Redis. If the process is dead, the socket refuses instantly.
    const healthServer = Bun.serve({
      port: HEALTH_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return Response.json({ status: "ok", pid: process.pid });
        }
        return new Response("not found", { status: 404 });
      },
    });
    console.log(`[worker] health endpoint on http://localhost:${healthServer.port}/health`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[worker] received ${signal}, shutting down...`);
      try {
        healthServer.stop(true);
        await redis.quit();
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
