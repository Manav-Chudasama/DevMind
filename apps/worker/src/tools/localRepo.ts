import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { simpleGit, type SimpleGit } from "simple-git";

const GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME ?? "DevMind";
const GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL ?? "devmind@users.noreply.github.com";

export interface Worktree {
  /** Absolute path to the temporary checkout. */
  dir: string;
  branch: string;
  git: SimpleGit;
}

/**
 * Phase 2 clones with `--depth 1`. Worktrees are fine on a shallow repo, but
 * pushing a branch from one can be rejected with "shallow update not allowed"
 * depending on what the remote already has. Unshallowing is idempotent and
 * only costs something the first time, so do it before we need to push rather
 * than surfacing a confusing failure at push time.
 */
async function ensureFullHistory(git: SimpleGit): Promise<void> {
  const isShallow = (await git.raw("rev-parse", "--is-shallow-repository")).trim();
  if (isShallow === "true") {
    await git.fetch(["--unshallow"]);
  }
}

/**
 * Creates a detached working copy on a fresh branch.
 *
 * Deliberately NOT done in the clone itself: that checkout is what the indexer
 * reads, so committing there would mean the next re-index embeds unmerged code,
 * and a crashed run would leave it dirty. The worktree is disposable.
 */
export async function createWorktree(
  clonePath: string,
  branch: string
): Promise<Worktree> {
  const git = simpleGit(clonePath);

  await ensureFullHistory(git);
  // Make sure we branch from the current remote tip, not a stale local ref.
  await git.fetch("origin");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devmind-wt-"));
  // mkdtemp created it; `worktree add` insists on creating it itself.
  await fs.rm(dir, { recursive: true, force: true });

  // Clean up a same-named branch left behind by an earlier failed run.
  await git.raw("branch", "-D", branch).catch(() => {});

  await git.raw("worktree", "add", "-b", branch, dir, "HEAD");

  const wtGit = simpleGit(dir);
  await wtGit.addConfig("user.name", GIT_AUTHOR_NAME);
  await wtGit.addConfig("user.email", GIT_AUTHOR_EMAIL);

  return { dir, branch, git: wtGit };
}

/** Reads a repo-relative file out of the worktree. */
export async function readWorktreeFile(
  wt: Worktree,
  relPath: string
): Promise<string> {
  return fs.readFile(path.join(wt.dir, relPath), "utf8");
}

/** Writes a repo-relative file into the worktree, creating parent dirs. */
export async function writeWorktreeFile(
  wt: Worktree,
  relPath: string,
  content: string
): Promise<void> {
  const full = path.join(wt.dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

export async function commitAll(wt: Worktree, message: string): Promise<boolean> {
  await wt.git.add(".");
  const status = await wt.git.status();
  if (status.staged.length === 0) return false; // nothing actually changed
  await wt.git.commit(message);
  return true;
}

/**
 * Pushes the worktree branch using the token as a one-shot remote URL.
 *
 * The credential is passed as an argument to this single command and never
 * written to .git/config, so it can't leak via a later `git remote -v`. The URL
 * is scrubbed from any error before it propagates.
 */
export async function pushBranch(
  wt: Worktree,
  owner: string,
  repo: string,
  token: string
): Promise<void> {
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    await wt.git.push(authUrl, wt.branch, ["--set-upstream"]);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`git push failed: ${raw.replaceAll(token, "***")}`);
  }
}

/**
 * Removes the worktree and its branch from the clone. Always call this, even on
 * failure — otherwise `git worktree list` accumulates dead entries that block
 * reusing the branch name.
 */
export async function removeWorktree(
  clonePath: string,
  wt: Worktree
): Promise<void> {
  const git = simpleGit(clonePath);
  await git.raw("worktree", "remove", "--force", wt.dir).catch(() => {});
  await git.raw("branch", "-D", wt.branch).catch(() => {});
  await fs.rm(wt.dir, { recursive: true, force: true }).catch(() => {});
}

/** Default branch of the clone, for the PR base. */
export async function getDefaultBranch(clonePath: string): Promise<string> {
  const git = simpleGit(clonePath);
  try {
    // e.g. "refs/remotes/origin/main" -> "main"
    const ref = await git.raw("symbolic-ref", "refs/remotes/origin/HEAD");
    return ref.trim().split("/").pop() || "main";
  } catch {
    const branch = await git.raw("rev-parse", "--abbrev-ref", "HEAD");
    return branch.trim() || "main";
  }
}
