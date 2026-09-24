import path from "node:path";
import fs from "node:fs/promises";
import { simpleGit } from "simple-git";
import { sql } from "../db/client";
import { parseGithubUrl, registerWebhook } from "./github";
import { enqueueIndexRepo } from "./queue";
import type { Repo } from "@devmind/shared";

const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const REPOS_BASE_PATH = process.env.REPOS_BASE_PATH ?? "./repos";

export interface RegisterResult {
  repo: Repo;
  alreadyExisted: boolean;
}

/**
 * Full register flow:
 *   1. Parse + canonicalize the GitHub URL
 *   2. Insert row (or return existing on UNIQUE conflict — idempotent)
 *   3. Clone repo to REPOS_BASE_PATH/<id> (shallow)
 *   4. Register GitHub webhook -> PUBLIC_URL/api/webhook/<id>
 *   5. Update row with clone_path + webhook_id
 *   6. Enqueue index-repo job (Phase 3 consumer will pick this up)
 *
 * On any failure after the row exists, sets repos.status = 'error' and re-throws.
 */
export async function registerRepo(githubUrlInput: string): Promise<RegisterResult> {
  const { owner, repoName, githubUrl } = parseGithubUrl(githubUrlInput);

  // Step 2 — idempotent upsert. ON CONFLICT DO NOTHING returns 0 rows if the URL
  // already exists; we then decide whether to short-circuit (fully registered)
  // or resume the setup (previous attempt failed halfway).
  const [inserted] = await sql<Repo[]>`
    INSERT INTO repos (github_url, owner, repo_name)
    VALUES (${githubUrl}, ${owner}, ${repoName})
    ON CONFLICT (github_url) DO NOTHING
    RETURNING *
  `;

  let repo: Repo;
  let existedBefore = false;

  if (inserted) {
    repo = inserted;
  } else {
    const [existing] = await sql<Repo[]>`
      SELECT * FROM repos WHERE github_url = ${githubUrl}
    `;
    if (!existing) {
      throw new Error("Repo vanished mid-register"); // extremely unlikely race
    }
    repo = existing;
    existedBefore = true;

    // Fully registered already? No work to redo.
    const isFullyRegistered =
      Boolean(existing.webhook_id) &&
      Boolean(existing.clone_path) &&
      existing.status !== "error";
    if (isFullyRegistered) {
      return { repo, alreadyExisted: true };
    }
    // Otherwise fall through and finish the setup on this same row.
  }

  const repoId = repo.id;

  try {
    // Step 3 — clone. Absolute path so we're independent of the API's cwd.
    const baseDirAbs = path.resolve(REPOS_BASE_PATH);
    await fs.mkdir(baseDirAbs, { recursive: true });
    const clonePath = path.join(baseDirAbs, repoId);

    // If a previous attempt left a partial dir, wipe it before re-cloning.
    await fs.rm(clonePath, { recursive: true, force: true });

    // Shallow clone — full history isn't needed for RAG.
    await simpleGit().clone(githubUrl, clonePath, ["--depth", "1"]);

    // Step 4 — webhook. Callback URL uses the row id so we can route in the handler.
    const callbackUrl = `${PUBLIC_URL}/api/webhook/${repoId}`;
    const webhookId = await registerWebhook({
      owner,
      repo: repoName,
      callbackUrl,
    });

    // Step 5 — persist infra facts on the row. Reset status to 'pending' so a
    // successful retry clears a prior 'error'. Indexer (Phase 3) moves it to
    // 'indexing' -> 'ready'.
    const [updated] = await sql<Repo[]>`
      UPDATE repos
      SET clone_path = ${clonePath},
          webhook_id = ${webhookId},
          status     = 'pending'
      WHERE id = ${repoId}
      RETURNING *
    `;

    // Step 6 — publish. Fires and returns; the Phase 3 worker consumes it.
    await enqueueIndexRepo({ repoId, githubUrl, clonePath });

    return { repo: updated, alreadyExisted: existedBefore };
  } catch (err) {
    // Mark the row as errored so the UI can surface it. Don't throw from the
    // catch (best-effort cleanup); let the original error propagate.
    await sql`UPDATE repos SET status = 'error' WHERE id = ${repoId}`.catch(() => {});
    throw err;
  }
}
