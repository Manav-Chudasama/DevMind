import { Router } from "express";
import { z } from "zod";
import { sql } from "../db/client";
import { registerRepo } from "../services/repo";
import { enqueueIndexRepo } from "../services/queue";
import type { Repo } from "@devmind/shared";

const WORKER_BASE_URL = (
  process.env.WORKER_BASE_URL ?? "http://localhost:8081"
).replace(/\/+$/, "");

const router = Router();

// ─── POST /api/repos ──────────────────────────────────────────────────────────

const RegisterBody = z.object({
  github_url: z.string().min(1, "github_url is required"),
});

router.post("/", async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const { repo, alreadyExisted } = await registerRepo(parsed.data.github_url);
    return res.status(alreadyExisted ? 200 : 201).json(repo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[repos] register failed:", message);
    // 400 for user-caused URL parse errors, 500 for infra failures.
    const status = message.startsWith("Invalid GitHub URL") ? 400 : 500;
    return res.status(status).json({ error: "register_failed", message });
  }
});

// ─── GET /api/repos ───────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const rows = await sql<Repo[]>`
    SELECT * FROM repos ORDER BY created_at DESC
  `;
  res.json(rows);
});

// ─── POST /api/repos/:id/reindex ──────────────────────────────────────────────
// Re-runs indexing against the existing clone. Deliberately does NOT re-clone or
// touch GitHub — re-POSTing /api/repos for an errored repo would register a
// second webhook, since registerRepo has no existing-webhook cleanup yet.

router.post("/:id/reindex", async (req, res) => {
  const [repo] = await sql<Repo[]>`
    SELECT * FROM repos WHERE id = ${req.params.id}
  `;
  if (!repo) return res.status(404).json({ error: "not_found" });

  if (!repo.clone_path) {
    return res.status(409).json({
      error: "not_cloned",
      message: "Repo has no clone on disk — register it again first",
    });
  }

  const { jobId, enqueued } = await enqueueIndexRepo({
    repoId: repo.id,
    githubUrl: repo.github_url,
    clonePath: repo.clone_path,
  });

  if (!enqueued) {
    return res.status(409).json({
      error: "already_queued",
      message: "An index job for this repo is already waiting or running",
      jobId,
    });
  }

  // Clear a stale 'error' so the UI doesn't show failure while the retry waits.
  await sql`UPDATE repos SET status = 'pending' WHERE id = ${repo.id}`;

  return res.status(202).json({ jobId, repoId: repo.id });
});

// ─── GET /api/repos/:id/search ────────────────────────────────────────────────
// Thin proxy to the worker, which owns the only copy of the embedder. Declared
// before /:id so the more specific path is matched first.

router.get("/:id/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.status(400).json({ error: "missing_query", hint: "pass ?q=..." });
  }

  const target = new URL(`${WORKER_BASE_URL}/search`);
  target.searchParams.set("repoId", req.params.id);
  target.searchParams.set("q", q);
  if (req.query.k) target.searchParams.set("k", String(req.query.k));
  if (req.query.minSimilarity) {
    target.searchParams.set("minSimilarity", String(req.query.minSimilarity));
  }

  try {
    // Generous timeout: the worker has to embed the query via OpenAI first.
    const r = await fetch(target, { signal: AbortSignal.timeout(20_000) });
    const body = await r.json();
    return res.status(r.status).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[repos] search proxy failed:", message);
    return res.status(503).json({ error: "worker_unreachable", message });
  }
});

// ─── GET /api/repos/:id ───────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const [row] = await sql<Repo[]>`
    SELECT * FROM repos WHERE id = ${req.params.id}
  `;
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

export default router;
