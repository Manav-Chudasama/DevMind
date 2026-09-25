import { Router } from "express";
import Redis from "ioredis";
import { sql } from "../db/client";
import type { Job } from "@devmind/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const router = Router();

// ─── GET /api/jobs ────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const rows = await sql<Job[]>`
    SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200
  `;
  res.json(rows);
});

// ─── GET /api/jobs/:id/stream (SSE) ──────────────────────────────────────────

router.get("/:id/stream", async (req, res) => {
  const jobId = req.params.id;

  const [row] = await sql<Job[]>`
    SELECT * FROM jobs WHERE id = ${jobId}
  `;

  if (!row) {
    return res.status(404).json({ error: "not_found" });
  }

  // Set SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Flush historical logs from DB first
  const historicalLogs = row.agent_logs ?? [];
  for (const entry of historicalLogs) {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  // If already in a terminal state, emit final status and finish
  if (row.status === "done" || row.status === "declined" || row.status === "failed") {
    res.write(
      `event: status\ndata: ${JSON.stringify({ status: row.status, pr_url: row.pr_url })}\n\n`
    );
    res.end();
    return;
  }

  // Active job: subscribe to Redis channel
  const subscriber = new Redis(REDIS_URL);
  const channel = `devmind:logs:${jobId}`;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    clearInterval(keepAlive);
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.quit().catch(() => {});
  };

  const keepAlive = setInterval(() => {
    if (!isClosed) {
      res.write(": keep-alive\n\n");
    }
  }, 15000);

  subscriber.on("message", (_ch, message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === "log") {
        res.write(`event: log\ndata: ${JSON.stringify(parsed.data)}\n\n`);
      } else if (parsed.type === "status") {
        res.write(`event: status\ndata: ${JSON.stringify(parsed.data)}\n\n`);
        const status = parsed.data.status;
        if (status === "done" || status === "declined" || status === "failed") {
          cleanup();
          res.end();
        }
      }
    } catch (e) {
      console.error("[sse] parse error:", e);
    }
  });

  await subscriber.subscribe(channel);

  req.on("close", cleanup);
});

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const [row] = await sql<Job[]>`
    SELECT * FROM jobs WHERE id = ${req.params.id}
  `;
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

export default router;
