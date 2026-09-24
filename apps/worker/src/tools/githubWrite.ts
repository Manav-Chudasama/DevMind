import { Octokit } from "octokit";

/**
 * The only two operations that genuinely require the GitHub API.
 *
 * Reading files, branching, committing and pushing are all plain git and happen
 * against the local worktree (see tools/localRepo.ts). Pull requests and issue
 * comments are GitHub product features with no git equivalent, so they live here.
 */

let _octokit: Octokit | null = null;
function octokit(): Octokit {
  if (!_octokit) {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not set — cannot open PRs or comment");
    }
    _octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return _octokit;
}

export function getGithubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set — cannot push");
  return token;
}

export interface CreatePullRequestArgs {
  owner: string;
  repo: string;
  head: string; // branch we pushed
  base: string; // default branch
  title: string;
  body: string;
}

export async function createPullRequest(
  args: CreatePullRequestArgs
): Promise<string> {
  const { data } = await octokit().request("POST /repos/{owner}/{repo}/pulls", {
    owner: args.owner,
    repo: args.repo,
    title: args.title,
    body: args.body,
    head: args.head,
    base: args.base,
  });
  return data.html_url;
}

export async function postIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await octokit().request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    { owner, repo, issue_number: issueNumber, body }
  );
}
