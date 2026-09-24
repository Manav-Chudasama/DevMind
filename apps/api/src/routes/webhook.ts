import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "../db/client";
import { enqueueFixIssue } from "../services/queue";
import type { Job, Repo } from "@devmind/shared";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";

const router = Router();

// ─── POST /api/webhook/:repo_id ───────────────────────────────────────────────
// NOTE: this router MUST be mounted with express.raw() (see index.ts) so the
// HMAC can be computed over the exact bytes GitHub signed. Once JSON is parsed
// and re-serialized, whitespace/ordering changes invalidate the signature.

router.post("/:repo_id", async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: "expected_raw_body" });
  }

  // ── 1. Verify signature (constant-time) ─────────────────────────────────────
  const signatureHeader = req.header("x-hub-signature-256") ?? "";
  const expected =
    "sha256=" +
    createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  // ── 2. Parse payload + event ────────────────────────────────────────────────
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }
  const event = req.header("x-github-event");

  // Ping is sent by GitHub when a webhook is first created. Just ack it.
  if (event === "ping") {
    return res.status(200).json({ pong: true });
  }

  // Only issue-opened events produce work. Everything else is acknowledged with
  // 204 so GitHub does not retry.
  if (event !== "issues" || payload?.action !== "opened") {
    return res.status(204).end();
  }

  // ── 3. Confirm the repo exists in our DB ────────────────────────────────────
  const repoId = req.params.repo_id;
  const [repo] = await sql<Repo[]>`SELECT * FROM repos WHERE id = ${repoId}`;
  if (!repo) {
    // Signature was valid but we don't know this repo. Return 410 so GitHub
    // eventually disables the delivery attempts.
    return res.status(410).json({ error: "unknown_repo" });
  }

  const issue = payload.issue;
  if (!issue || typeof issue.number !== "number") {
    return res.status(400).json({ error: "malformed_issue_payload" });
  }

  // ── 4. Insert the job row + enqueue ─────────────────────────────────────────
  try {
    const [job] = await sql<Job[]>`
      INSERT INTO jobs (repo_id, issue_number, issue_title, issue_body)
      VALUES (${repoId}, ${issue.number}, ${issue.title ?? null}, ${issue.body ?? null})
      RETURNING *
    `;

    await enqueueFixIssue({
      jobId: job.id,
      repoId,
      owner: repo.owner,
      repoName: repo.repo_name,
      issueNumber: issue.number,
      issueTitle: issue.title ?? "",
      issueBody: issue.body ?? "",
    });

    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[webhook] failed to enqueue fix-issue:", message);
    // 500 makes GitHub retry, which is what we want if enqueue transiently failed.
    return res.status(500).json({ error: "enqueue_failed" });
  }
});

export default router;
