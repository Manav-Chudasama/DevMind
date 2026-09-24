import { z } from "zod";
import { diffLines } from "diff";
import type { FileDiff } from "@devmind/shared";
import { complete } from "../llm";
import { log, type PipelineStateType } from "../graph/state";

const ReviewSchema = z.object({
  score: z
    .number()
    .describe("1-10. 7+ means mergeable. Below 7 sends it back to the Coder."),
  feedback: z
    .string()
    .describe("Specific, actionable notes. Empty string if the change is clean."),
  concerns: z.array(z.string()).describe("Distinct problems, most serious first"),
});

const SYSTEM = `You are the Reviewer in an autonomous code-fixing pipeline. You are the last check before a pull request reaches a human.

Score 1-10, where 7 or above means "I would approve this".

Judge:
- Correctness: does it actually fix the described issue?
- Regressions: does it break existing behaviour or callers?
- Scope: does it change lines the fix did not require?
- Consistency: does it match the surrounding code's conventions?

Scope violations are real defects, not nitpicks. If the diff reformats lines unrelated to the fix - adding or removing semicolons, changing quotes, re-indenting, reordering imports - cap the score at 6 and say exactly which lines to revert. A reviewing human has to read every changed line, so noise costs them real time and hides the actual change.

You will be given a COSMETIC CHANGE REPORT computed mechanically from the diff. Trust it: if it reports unrelated formatting changes, they are present, even if they look harmless to you.

Do not deduct for missing tests, missing documentation, or stylistic preferences the codebase does not already enforce.

Be strict about correctness and scope. Be lenient about taste.`;

/** Collapses away whitespace, CR, and trailing semicolons for equivalence testing. */
const normalise = (line: string) =>
  line.replace(/\r/g, "").replace(/\s+/g, "").replace(/;+$/, "");

interface CosmeticReport {
  cosmeticLines: number;
  substantiveLines: number;
  samples: string[];
}

/**
 * Finds lines that were "changed" but are semantically identical once
 * whitespace and semicolons are ignored.
 *
 * The model reliably fails to self-report this - the first real run scored a
 * diff 10/10 while it had quietly added semicolons throughout a semicolon-free
 * file. Computing it mechanically and handing it over as evidence works where
 * asking nicely did not.
 */
function analyseCosmetic(diffs: FileDiff[]): CosmeticReport {
  const removed: string[] = [];
  const added: string[] = [];

  for (const d of diffs) {
    for (const part of diffLines(d.original, d.patched)) {
        const lines = part.value.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (part.removed) removed.push(...lines);
      else if (part.added) added.push(...lines);
    }
  }

  const removedPool = new Map<string, number>();
  for (const line of removed) {
    const k = normalise(line);
    removedPool.set(k, (removedPool.get(k) ?? 0) + 1);
  }

  let cosmeticLines = 0;
  const samples: string[] = [];
  for (const line of added) {
    const k = normalise(line);
    const count = removedPool.get(k) ?? 0;
    if (count > 0) {
      removedPool.set(k, count - 1);
      cosmeticLines++;
      if (samples.length < 5) samples.push(line.trim());
    }
  }

  return {
    cosmeticLines,
    substantiveLines: added.length - cosmeticLines,
    samples,
  };
}

function buildCosmeticSection(report: CosmeticReport): string {
  if (report.cosmeticLines === 0) {
    return "## Cosmetic change report\nNone detected. Every changed line differs substantively.";
  }
  return `## Cosmetic change report
${report.cosmeticLines} changed line(s) are IDENTICAL to the original once whitespace and semicolons are ignored. These are pure reformatting and do not belong in this diff.
${report.substantiveLines} line(s) are substantive.

Examples of the reformatted lines:
${report.samples.map((s) => `  ${s}`).join("\n")}

Cap the score at 6 and instruct the Coder to revert these lines to their original form.`;
}

export async function reviewerAgent(state: PipelineStateType) {
  if (state.codeDiffs.length === 0) {
    return {
      reviewScore: 0,
      reviewFeedback: "No changes were produced. Produce a concrete edit.",
      ...log("reviewer", "score 0/10 — coder returned no changes"),
    };
  }

  const cosmetic = analyseCosmetic(state.codeDiffs);
  const diffs = state.codeDiffs.map((d) => d.diff).join("\n");

  const result = await complete({
    agent: "reviewer",
    system: SYSTEM,
    user: `## Issue #${state.issueNumber}: ${state.issueTitle}

${state.issueBody}

## Plan the Coder was given
${state.plan}

## Proposed diff
\`\`\`diff
${diffs}
\`\`\`

${buildCosmeticSection(cosmetic)}`,
    schema: ReviewSchema,
    temperature: 0.1,
  });

  // Enforce the cap deterministically. The model was told to do this, but the
  // whole reason this check exists is that it does not always comply.
  const score =
    cosmetic.cosmeticLines > 0 ? Math.min(result.score, 6) : result.score;

  const feedback = [
    result.feedback,
    ...result.concerns.map((c) => `- ${c}`),
    cosmetic.cosmeticLines > 0
      ? `- Revert ${cosmetic.cosmeticLines} reformatted line(s) that are unrelated to the fix (whitespace/semicolon-only changes). Preserve the file's existing style.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    reviewScore: score,
    reviewFeedback: feedback,
    ...log(
      "reviewer",
      `score ${score}/10` +
        (cosmetic.cosmeticLines > 0
          ? ` (capped from ${result.score} — ${cosmetic.cosmeticLines} cosmetic line(s))`
          : "") +
        (result.concerns.length ? ` — ${result.concerns.length} concern(s)` : "")
    ),
  };
}
