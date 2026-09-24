import { retrieveContext } from "../rag/retriever";
import { log, type PipelineStateType } from "../graph/state";

/** Slightly wider than the search default — the Planner benefits from more context. */
const TOP_K = 8;

export async function ragAgent(state: PipelineStateType) {
  // Title plus body: the title usually carries the domain noun, the body the
  // symptom. Embedding them together beats either alone.
  const query = `${state.issueTitle}\n\n${state.issueBody}`.trim();

  const retrievedContext = await retrieveContext(query, state.repoId, TOP_K);

  const files = [...new Set(retrievedContext.map((c) => c.file_path))];
  return {
    retrievedContext,
    ...log(
      "rag",
      retrievedContext.length === 0
        ? "no relevant chunks found"
        : `${retrievedContext.length} chunks from ${files.length} files: ${files.join(", ")}`
    ),
  };
}
