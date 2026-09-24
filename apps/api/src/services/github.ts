import { Octokit } from "octokit";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

if (!GITHUB_TOKEN) {
  console.warn(
    "[github] GITHUB_TOKEN is not set — webhook registration + PR creation will fail"
  );
}
if (!GITHUB_WEBHOOK_SECRET) {
  console.warn(
    "[github] GITHUB_WEBHOOK_SECRET is not set — webhooks cannot be verified"
  );
}

// Lazy singleton so importing this module doesn't crash on missing env in tests.
let _octokit: Octokit | null = null;
function octokit(): Octokit {
  if (!_octokit) _octokit = new Octokit({ auth: GITHUB_TOKEN });
  return _octokit;
}

// ─── URL parsing ──────────────────────────────────────────────────────────────

export interface ParsedRepo {
  owner: string;
  repoName: string;
  githubUrl: string; // canonical https form: https://github.com/owner/repo
}

/**
 * Accepts:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo/       (trailing slash)
 *   - git@github.com:owner/repo.git
 *
 * Rejects anything else (e.g. gitlab, empty owner/repo, extra path segments).
 */
export function parseGithubUrl(input: string): ParsedRepo {
  const trimmed = input.trim();

  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/i
  );
  const sshMatch = trimmed.match(/^git@github\.com:([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/i);

  const match = httpsMatch ?? sshMatch;
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${input}`);
  }

  const [, owner, repoName] = match;
  return {
    owner,
    repoName,
    githubUrl: `https://github.com/${owner}/${repoName}`,
  };
}

// ─── Webhook management ───────────────────────────────────────────────────────

export interface EnsureWebhookArgs {
  owner: string;
  repo: string;
  callbackUrl: string; // full https URL GitHub will POST to
}

export interface EnsureWebhookResult {
  webhookId: string;
  action: "created" | "reused" | "updated";
}

const WEBHOOK_EVENTS = ["issues"];

/**
 * Idempotently ensures exactly one DevMind webhook exists on the repo.
 *
 * Identity is matched on the callback URL's *path* (`/api/webhook/<repoId>`),
 * not the full URL, because the host changes every time an ngrok/devtunnel
 * session restarts. Matching on the full URL would treat a tunnel restart as a
 * brand new hook and pile up duplicates, with every stale one delivering to a
 * dead host.
 *
 * Always PATCHes the config on the reuse path so a rotated
 * GITHUB_WEBHOOK_SECRET propagates instead of silently breaking signature
 * verification.
 */
export async function ensureWebhook({
  owner,
  repo,
  callbackUrl,
}: EnsureWebhookArgs): Promise<EnsureWebhookResult> {
  if (!GITHUB_WEBHOOK_SECRET) {
    throw new Error("GITHUB_WEBHOOK_SECRET must be set before registering webhooks");
  }

  const config = {
    url: callbackUrl,
    content_type: "json" as const,
    secret: GITHUB_WEBHOOK_SECRET,
    insecure_ssl: "0" as const,
  };

  const targetPath = new URL(callbackUrl).pathname;

  const { data: hooks } = await octokit().request("GET /repos/{owner}/{repo}/hooks", {
    owner,
    repo,
    per_page: 100,
  });

  const existing = hooks.find((h) => {
    const url = h.config?.url;
    if (!url) return false;
    try {
      return new URL(url).pathname === targetPath;
    } catch {
      return false;
    }
  });

  if (existing) {
    const urlChanged = existing.config?.url !== callbackUrl;
    await octokit().request("PATCH /repos/{owner}/{repo}/hooks/{hook_id}", {
      owner,
      repo,
      hook_id: existing.id,
      active: true,
      events: WEBHOOK_EVENTS,
      config,
    });
    return {
      webhookId: String(existing.id),
      action: urlChanged ? "updated" : "reused",
    };
  }

  const { data } = await octokit().request("POST /repos/{owner}/{repo}/hooks", {
    owner,
    repo,
    name: "web",
    active: true,
    events: WEBHOOK_EVENTS,
    config,
  });

  return { webhookId: String(data.id), action: "created" };
}

export async function deleteWebhook(
  owner: string,
  repo: string,
  hookId: string
): Promise<void> {
  await octokit().request("DELETE /repos/{owner}/{repo}/hooks/{hook_id}", {
    owner,
    repo,
    hook_id: Number(hookId),
  });
}
