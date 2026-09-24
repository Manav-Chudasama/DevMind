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

export interface RegisterWebhookArgs {
  owner: string;
  repo: string;
  callbackUrl: string; // full https URL GitHub will POST to
}

/**
 * Creates a webhook on the given repo that listens for `issues` events.
 * Returns the numeric hook id (stored as text in the `repos.webhook_id` column).
 *
 * Throws if the token lacks `admin:repo_hook` scope or the repo doesn't exist.
 */
export async function registerWebhook({
  owner,
  repo,
  callbackUrl,
}: RegisterWebhookArgs): Promise<string> {
  if (!GITHUB_WEBHOOK_SECRET) {
    throw new Error("GITHUB_WEBHOOK_SECRET must be set before registering webhooks");
  }

  const { data } = await octokit().request("POST /repos/{owner}/{repo}/hooks", {
    owner,
    repo,
    name: "web",
    active: true,
    events: ["issues"],
    config: {
      url: callbackUrl,
      content_type: "json",
      secret: GITHUB_WEBHOOK_SECRET,
      insecure_ssl: "0",
    },
  });

  return String(data.id);
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
