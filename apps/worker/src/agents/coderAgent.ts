import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { createTwoFilesPatch } from "diff";
import type { FileDiff } from "@devmind/shared";
import { complete } from "../llm";
import { log, type PipelineStateType } from "../graph/state";

const FileEditSchema = z.object({
  file_path: z.string().describe("Repo-relative path, exactly as given"),
  patched_content: z
    .string()
    .describe("The COMPLETE new contents of the file, not a diff or a fragment"),
});

const CoderSchema = z.object({
  files: z.array(FileEditSchema),
  summary: z.string().describe("One or two sentences describing the change"),
});

const SYSTEM = `You are the Coder in an autonomous code-fixing pipeline.

Return the COMPLETE new contents of every file you modify. Do not return diffs, patches, ellipses, or "... rest of file unchanged" markers — the file is written to disk verbatim from your output, so anything you omit is deleted.

Rules:
- Make the smallest change that fixes the issue. Every line you alter that is not required by the fix is a defect.
- Preserve the file's existing style EXACTLY. Before you write, look at the file and note: does it use semicolons or not? Single or double quotes? Tabs or spaces? Trailing commas? Match what is already there, even if you would personally write it differently. Adding semicolons to a semicolon-free file is a defect.
- Preserve the trailing newline exactly as the original has it.
- Do not reorganise imports, rename anything, or fix unrelated problems you notice.
- Do not add comments explaining your fix. The pull request body carries that.
- If review feedback is provided, address it specifically rather than rewriting from scratch.`;

/**
 * Guards against the model returning a path that escapes the repo. Paths come
 * from LLM output and get joined to a filesystem root, so this is the boundary
 * where traversal has to be stopped.
 */
function resolveSafe(root: string, relPath: string): string {
  const normalised = path.normalize(relPath).replace(/^([/\\])+/, "");
  const full = path.resolve(root, normalised);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error(`refusing path outside repo: ${relPath}`);
  }
  return full;
}

async function readOriginal(clonePath: string, relPath: string): Promise<string> {
  try {
    return await fs.readFile(resolveSafe(clonePath, relPath), "utf8");
  } catch {
    return ""; // new file
  }
}

/**
 * Models routinely drop the final newline, which shows up in every PR as a
 * spurious "\ No newline at end of file". Prompting doesn't reliably prevent
 * it, so correct it mechanically instead.
 */
function restoreTrailingNewline(original: string, patched: string): string {
  if (original === "" || patched === "") return patched;
  const originalEnds = original.endsWith("\n");
  const patchedEnds = patched.endsWith("\n");
  if (originalEnds && !patchedEnds) return patched + "\n";
  if (!originalEnds && patchedEnds) return patched.replace(/\n+$/, "");
  return patched;
}

/**
 * Models (and Windows) often emit CRLF. If the original file is LF, every line
 * looks changed — the Reviewer's cosmetic detector then false-positives and
 * caps the score at 6 even when the actual git diff is four clean lines.
 * Match the original's ending style before we compute the patch.
 */
function matchLineEndings(original: string, patched: string): string {
  const originalCrlf = original.includes("\r\n");
  const normalised = patched.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return originalCrlf ? normalised.replace(/\n/g, "\r\n") : normalised;
}

export async function coderAgent(state: PipelineStateType) {
  const iteration = state.iterationCount + 1;

  // Read current contents from the clone. Each iteration starts from the
  // ORIGINAL file, not the previous attempt — a retry is a fresh attempt
  // informed by feedback, not an incremental patch on top of a rejected one.
  const originals = new Map<string, string>();
  for (const relPath of state.targetFiles) {
    originals.set(relPath, await readOriginal(state.clonePath, relPath));
  }

  const fileBlocks = [...originals.entries()]
    .map(([p, content]) => `--- ${p} ---\n${content || "(new file)"}`)
    .join("\n\n");

  const feedback =
    state.reviewFeedback && iteration > 1
      ? `\n\n## Review feedback on your previous attempt (score ${state.reviewScore}/10)\n${state.reviewFeedback}\n\nAddress these points.`
      : "";

  const result = await complete({
    agent: "coder",
    system: SYSTEM,
    user: `## Issue #${state.issueNumber}: ${state.issueTitle}

${state.issueBody}

## Plan
${state.plan}

## Current file contents
${fileBlocks}${feedback}`,
    schema: CoderSchema,
    temperature: 0.1,
  });

  // Compute diffs locally. Models are unreliable at emitting valid unified
  // diffs, so we take full contents from them and derive the patch ourselves.
  const codeDiffs: FileDiff[] = [];
  for (const file of result.files) {
    resolveSafe(state.clonePath, file.file_path); // throws on traversal
    const original = originals.get(file.file_path) ?? (await readOriginal(state.clonePath, file.file_path));

    const patched = restoreTrailingNewline(
      original,
      matchLineEndings(original, file.patched_content)
    );
    if (original === patched) continue; // model returned a no-op

    codeDiffs.push({
      file_path: file.file_path,
      original,
      patched,
      diff: createTwoFilesPatch(
        `a/${file.file_path}`,
        `b/${file.file_path}`,
        original,
        patched
      ),
    });
  }

  return {
    codeDiffs,
    codeSummary: result.summary,
    iterationCount: iteration,
    ...log(
      "coder",
      `iteration ${iteration} — ${codeDiffs.length} file(s) changed: ${codeDiffs.map((d) => d.file_path).join(", ") || "none"}`
    ),
  };
}
