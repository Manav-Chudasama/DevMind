import { Router } from "express";
import { z } from "zod";
import { sql } from "../db/client";
import { registerRepo } from "../services/repo";
import type { Repo } from "@devmind/shared";

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

// ─── GET /api/repos/:id ───────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const [row] = await sql<Repo[]>`
    SELECT * FROM repos WHERE id = ${req.params.id}
  `;
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

export default router;
