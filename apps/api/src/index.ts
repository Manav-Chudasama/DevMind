import express from "express";
import postgres from "postgres";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 8080;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ─── DB + Redis clients ───────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { max: 5 });
const redis = new Redis(REDIS_URL, { lazyConnect: true });

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    await sql`SELECT 1`;
    const pong = await redis.ping();

    res.json({
      status: "ok",
      postgres: "up",
      redis: pong === "PONG" ? "up" : "degraded",
    });
  } catch (err) {
    console.error("[api] health check failed:", err);
    res.status(503).json({ status: "error", error: String(err) });
  }
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
