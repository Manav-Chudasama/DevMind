import type { Job } from "bullmq";
import type { FixIssueJob, JobStatus, AgentLog, Repo } from "@devmind/shared";
import { sql } from "../db/client";
import { buildPipeline } from "../graph/pipeline";
import { postIssueComment } from "../tools/githubWrite";

export interface FixIssueResult {
  status: JobStatus;
  prUrl: string;
  iterations: number;
  reviewScore: number;
}

/** Single write point for the job row so status and logs never drift apart. */
async function persist(
  jobId: string,
  status: JobStatus,
  logs: AgentLog[],
  prUrl?: string
): Promise<void> {
  await sql`
    UPDATE jobs
    SET status     = ${status},
        agent_logs = ${sql.json(logs as never)},
        pr_url     = ${prUrl ?? null}
    WHERE id = ${jobId}
  `;
}

export async function handleFixIssue(
  job: Job<FixIssueJob>
): Promise<FixIssueResult> {
  const d = job.data;
  const tag = `[fix-issue #${d.issueNumber}]`;

  // Jobs enqueued before Phase 4 don't carry clonePath — fall back to the row.
  let clonePath = d.clonePath;
  if (!clonePath) {
    const [repo] = await sql<Repo[]>`
      SELECT clone_path FROM repos WHERE id = ${d.repoId}
    `;
    clonePath = repo?.clone_path;
  }
  if (!clonePath) {
    await persist(d.jobId, "failed", [
      {
        agent: "system",
        message: "no clone_path for this repo — cannot read code",
        timestamp: new Date().toISOString(),
      },
    ]);
    throw new Error(`${tag} repo ${d.repoId} has no clone on disk`);
  }

  await sql`UPDATE jobs SET status = 'running' WHERE id = ${d.jobId}`;
  console.log(`${tag} ${d.issueTitle}`);

  try {
    const pipeline = buildPipeline();
    const final = await pipeline.invoke({
      jobId: d.jobId,
      repoId: d.repoId,
      owner: d.owner,
      repoName: d.repoName,
      issueNumber: d.issueNumber,
      issueTitle: d.issueTitle,
      issueBody: d.issueBody ?? "",
      clonePath,
    });

    // "declined" is a legitimate terminal state, not a failure: the agent read
    // the issue, judged it non-actionable, and said so on GitHub.
    const status: JobStatus = final.action === "decline" ? "declined" : "done";

    await persist(d.jobId, status, final.agentLogs, final.prUrl || undefined);
    console.log(`${tag} ${status}${final.prUrl ? ` — ${final.prUrl}` : ""}`);

    return {
      status,
      prUrl: final.prUrl,
      iterations: final.iterationCount,
      reviewScore: final.reviewScore,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} failed:`, message);

    await persist(d.jobId, "failed", [
      {
        agent: "system",
        message: `pipeline failed: ${message}`,
        timestamp: new Date().toISOString(),
      },
    ]);

    // Tell the issue author rather than failing silently. Best-effort: never
    // let a comment failure mask the original error.
    await postIssueComment(
      d.owner,
      d.repoName,
      d.issueNumber,
      `DevMind attempted to process this issue but the run failed.\n\n\`\`\`\n${message}\n\`\`\`\n\n<sub>Automated by DevMind.</sub>`
    ).catch(() => {});

    throw err; // let BullMQ apply its retry policy
  }
}
