import { Router } from "express";
import { sql } from "../db/client";
import type { Job } from "@devmind/shared";

const router = Router();

// ─── GET /api/jobs ────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const rows = await sql<Job[]>`
    SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200
  `;
  res.json(rows);
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
