import { Annotation } from "@langchain/langgraph";
import type { AgentLog, CodeChunk, FileDiff } from "@devmind/shared";

/**
 * State carried through one issue's pipeline run.
 *
 * Every node receives the whole thing and returns a partial update. Only
 * `agentLogs` accumulates (via a reducer); everything else is last-write-wins,
 * which is what we want for the Coder/Reviewer loop — each iteration replaces
 * the previous diff and score rather than piling up.
 */
export const PipelineState = Annotation.Root({
  // ── Inputs, set once before invoke ──────────────────────────────────────
  jobId: Annotation<string>,
  repoId: Annotation<string>,
  owner: Annotation<string>,
  repoName: Annotation<string>,
  issueNumber: Annotation<number>,
  issueTitle: Annotation<string>,
  issueBody: Annotation<string>,
  clonePath: Annotation<string>,
  humanFeedback: Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  branch: Annotation<string>({ default: () => "", reducer: (_, b) => b }),

  // ── Orchestrator ────────────────────────────────────────────────────────
  pastMemory: Annotation<string>({ default: () => "", reducer: (_, b) => b }),

  // ── RAG ─────────────────────────────────────────────────────────────────
  retrievedContext: Annotation<CodeChunk[]>({
    default: () => [],
    reducer: (_, b) => b,
  }),

  // ── Planner ─────────────────────────────────────────────────────────────
  /** The core routing decision: is this an actionable code change at all? */
  action: Annotation<"fix" | "decline">({
    default: () => "decline",
    reducer: (_, b) => b,
  }),
  /** Markdown posted to the issue when action === "decline". */
  declineComment: Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  plan: Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  targetFiles: Annotation<string[]>({ default: () => [], reducer: (_, b) => b }),

  // ── Coder ───────────────────────────────────────────────────────────────
  codeDiffs: Annotation<FileDiff[]>({ default: () => [], reducer: (_, b) => b }),
  codeSummary: Annotation<string>({ default: () => "", reducer: (_, b) => b }),

  // ── Reviewer ────────────────────────────────────────────────────────────
  reviewScore: Annotation<number>({ default: () => 0, reducer: (_, b) => b }),
  reviewFeedback: Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  /** Incremented by the Coder; the loop guard reads it. */
  iterationCount: Annotation<number>({ default: () => 0, reducer: (_, b) => b }),

  // ── Finish ──────────────────────────────────────────────────────────────
  prUrl: Annotation<string>({ default: () => "", reducer: (_, b) => b }),

  // ── Logs: the one accumulating field ────────────────────────────────────
  agentLogs: Annotation<AgentLog[]>({
    default: () => [],
    reducer: (a, b) => a.concat(b),
  }),
});

export type PipelineStateType = typeof PipelineState.State;

/** Convenience for nodes appending a single log line. */
export function log(
  agent: AgentLog["agent"],
  message: string
): { agentLogs: AgentLog[] } {
  console.log(`[${agent}] ${message}`);
  return {
    agentLogs: [{ agent, message, timestamp: new Date().toISOString() }],
  };
}
