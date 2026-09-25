import { recallMemory } from "../memory/agentMemory";
import { log, type PipelineStateType } from "../graph/state";

/**
 * Entry node. Deliberately does no LLM work — it only loads prior context so
 * the Planner can see what has already been done in this repo.
 */
export async function orchestratorAgent(state: PipelineStateType) {
  const pastMemory = await recallMemory(state.repoId);

  const memoryMsg = pastMemory
    ? `recalled ${pastMemory.split("\n").length} prior fix note(s)`
    : "no prior memory for this repo";
  const feedbackMsg = state.humanFeedback
    ? ` | processing comment feedback: "${state.humanFeedback.slice(0, 80)}..."`
    : "";

  return {
    pastMemory,
    ...log("orchestrator", `${memoryMsg}${feedbackMsg}`),
  };
}
