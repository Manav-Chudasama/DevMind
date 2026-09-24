import { StateGraph, START, END } from "@langchain/langgraph";
import { PipelineState, type PipelineStateType } from "./state";
import { orchestratorAgent } from "../agents/orchestrator";
import { ragAgent } from "../agents/ragAgent";
import { plannerAgent } from "../agents/plannerAgent";
import { coderAgent } from "../agents/coderAgent";
import { reviewerAgent } from "../agents/reviewerAgent";
import { declineNode, finalizeNode } from "../agents/finalize";

const MAX_REVIEW_ITERATIONS = Number(process.env.MAX_REVIEW_ITERATIONS ?? 3);
const PASSING_SCORE = 7;

/** After the Planner: either we act on this issue, or we reply and stop. */
function routeAfterPlanner(state: PipelineStateType): "coder" | "decline" {
  return state.action === "fix" ? "coder" : "decline";
}

/**
 * After the Reviewer: loop back to the Coder only while the score is failing
 * AND we have iterations left.
 *
 * On the last iteration we finalize regardless of score. A mediocre PR that a
 * human can see and reject is strictly better than a job that silently
 * disappears — the reviewer's score is surfaced in the PR body either way.
 */
function routeAfterReviewer(state: PipelineStateType): "coder" | "finalize" {
  if (state.reviewScore >= PASSING_SCORE) return "finalize";
  if (state.iterationCount >= MAX_REVIEW_ITERATIONS) return "finalize";
  return "coder";
}

export function buildPipeline() {
  return new StateGraph(PipelineState)
    .addNode("orchestrator", orchestratorAgent)
    .addNode("rag", ragAgent)
    .addNode("planner", plannerAgent)
    .addNode("coder", coderAgent)
    .addNode("reviewer", reviewerAgent)
    .addNode("decline", declineNode)
    .addNode("finalize", finalizeNode)

    .addEdge(START, "orchestrator")
    .addEdge("orchestrator", "rag")
    .addEdge("rag", "planner")

    .addConditionalEdges("planner", routeAfterPlanner, {
      coder: "coder",
      decline: "decline",
    })

    .addEdge("coder", "reviewer")

    .addConditionalEdges("reviewer", routeAfterReviewer, {
      coder: "coder",
      finalize: "finalize",
    })

    .addEdge("decline", END)
    .addEdge("finalize", END)
    .compile();
}

export { MAX_REVIEW_ITERATIONS, PASSING_SCORE };
