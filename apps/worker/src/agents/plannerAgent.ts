import { z } from "zod";
import { complete } from "../llm";
import { log, type PipelineStateType } from "../graph/state";

// Structured outputs require every key to be present, so optional fields are
// `.nullable()` rather than `.optional()`.
const PlanSchema = z.object({
  action: z
    .enum(["fix", "decline"])
    .describe("fix = an actionable code change; decline = anything else"),
  reasoning: z.string().describe("One or two sentences on why this action"),
  declineComment: z
    .string()
    .nullable()
    .describe(
      "When declining: markdown to post on the issue. Courteous, specific about what is missing. Null when fixing."
    ),
  targetFiles: z
    .array(z.string())
    .describe("Repo-relative paths to modify. Empty when declining."),
  plan: z
    .string()
    .describe("When fixing: what changes in each file and why. Empty when declining."),
});

const SYSTEM = `You are the Planner in an autonomous code-fixing pipeline.

Your first and most important job is deciding whether the issue is an actionable code change at all.

Choose "decline" when the issue is any of:
- a test, placeholder, or smoke-check ("testing", "ignore this", "just checking")
- a question, discussion, or support request rather than a defect
- a feature request too vague to implement without guessing at requirements
- missing the information needed to locate the problem (no symptom, no expected behaviour)
- asking for something outside the codebase (infrastructure, credentials, third-party services)

Choose "fix" only when you can point at specific files and describe a concrete change.

Declining is a good outcome, not a failure. A wrong guess wastes the maintainer's review time and pollutes the repo with a meaningless pull request. When you decline, write declineComment directly to the issue author: say plainly why this cannot be acted on, and what a useful version of the issue would include.

Only reference files that appear in the provided context. Never invent paths.`;

function buildUserPrompt(state: PipelineStateType): string {
  const context =
    state.retrievedContext.length > 0
      ? state.retrievedContext
          .map(
            (c, i) =>
              `--- [${i + 1}] ${c.file_path} (similarity ${c.similarity.toFixed(3)}) ---\n${c.chunk_text}`
          )
          .join("\n\n")
      : "(no relevant code found — a strong signal this may not be actionable)";

  const memory = state.pastMemory
    ? `\n\n## Previously fixed in this repo\n${state.pastMemory}`
    : "";

  const feedbackSection = state.humanFeedback
    ? `\n\n## Developer Revision Request / Comment:\n${state.humanFeedback}\n(Note: The developer explicitly requested this change. Tailor your plan to address their feedback.)`
    : "";

  return `## Issue #${state.issueNumber}: ${state.issueTitle}

${state.issueBody || "(no description provided)"}${feedbackSection}

## Relevant code from the repository
${context}${memory}`;
}

export async function plannerAgent(state: PipelineStateType) {
  const result = await complete({
    agent: "planner",
    system: SYSTEM,
    user: buildUserPrompt(state),
    schema: PlanSchema,
    temperature: 0.1, // a judgement call — keep it stable
  });

  if (result.action === "decline") {
    return {
      action: "decline" as const,
      declineComment:
        result.declineComment ??
        "This issue does not appear to describe an actionable code change.",
      plan: "",
      targetFiles: [],
      ...log("planner", `DECLINE — ${result.reasoning}`),
    };
  }

  return {
    action: "fix" as const,
    plan: result.plan,
    targetFiles: result.targetFiles,
    declineComment: "",
    ...log(
      "planner",
      `FIX — ${result.targetFiles.length} file(s): ${result.targetFiles.join(", ")}`
    ),
  };
}
