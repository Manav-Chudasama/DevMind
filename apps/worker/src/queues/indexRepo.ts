import type { Job } from "bullmq";
import type { IndexRepoJob } from "@devmind/shared";
import { sql } from "../db/client";
import { walkRepo } from "../rag/walker";
import { chunkFile, buildEmbedText, type Chunk } from "../rag/chunker";
import { embedAll, toVectorLiteral } from "../rag/embedder";

/**
 * Rows per INSERT statement. Postgres caps a statement at 65535 bind parameters;
 * at 5 columns per row, 500 keeps us an order of magnitude clear of that.
 */
const INSERT_BATCH_SIZE = 500;

export interface IndexRepoResult {
  files: number;
  chunks: number;
}

interface PendingChunk {
  filePath: string;
  chunk: Chunk;
  embedText: string;
}

export async function handleIndexRepo(
  job: Job<IndexRepoJob>
): Promise<IndexRepoResult> {
  const { repoId, clonePath, githubUrl } = job.data;
  const log = (msg: string) => console.log(`[index-repo ${repoId.slice(0, 8)}] ${msg}`);

  try {
    await sql`UPDATE repos SET status = 'indexing' WHERE id = ${repoId}`;
    log(`indexing ${githubUrl}`);

    // ── Phase A: read + chunk. Cheap, local, no transaction. ──────────────────
    const files = await walkRepo(clonePath);
    log(`walked ${files.length} indexable files`);

    if (files.length === 0) {
      await sql`UPDATE repos SET status = 'ready' WHERE id = ${repoId}`;
      log("no indexable files — marking ready");
      return { files: 0, chunks: 0 };
    }

    const pending: PendingChunk[] = [];
    for (const file of files) {
      for (const chunk of chunkFile(file.content, file.relPath)) {
        pending.push({
          filePath: file.relPath,
          chunk,
          embedText: buildEmbedText(file.relPath, chunk),
        });
      }
    }
    log(`produced ${pending.length} chunks`);

    // ── Phase B: embed. Slow + network-bound, so deliberately NOT inside a
    // transaction — holding one open across minutes of OpenAI calls would pin
    // locks, bloat WAL, and throw away all paid-for work on any hiccup. ───────
    const vectors = await embedAll(
      pending.map((p) => p.embedText),
      (done, total) => {
        if (done % 500 === 0 || done === total) log(`embedded ${done}/${total}`);
      }
    );

    if (vectors.length !== pending.length) {
      throw new Error(
        `embedding count mismatch: got ${vectors.length}, expected ${pending.length}`
      );
    }

    // `chunk_text` stores the PURE code. The provenance header only ever went
    // into the embedded text — `file_path` is already its own column, so storing
    // it again would feed the path to Phase 4 agents twice.
    const rows = pending.map((p, i) => ({
      repo_id: repoId,
      file_path: p.filePath,
      chunk_index: p.chunk.chunkIndex,
      chunk_text: p.chunk.text,
      embedding: toVectorLiteral(vectors[i]),
    }));

    // ── Phase C: one short transaction for the swap. Milliseconds, not minutes.
    // If anything above threw, the old embeddings are still intact. ───────────
    await sql.begin(async (tx) => {
      await tx`DELETE FROM embeddings WHERE repo_id = ${repoId}`;

      for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
        const slice = rows.slice(i, i + INSERT_BATCH_SIZE);
        await tx`
          INSERT INTO embeddings ${tx(
            slice,
            "repo_id",
            "file_path",
            "chunk_index",
            "chunk_text",
            "embedding"
          )}
        `;
      }

      await tx`UPDATE repos SET status = 'ready' WHERE id = ${repoId}`;
    });

    log(`done — ${files.length} files, ${rows.length} chunks indexed`);
    return { files: files.length, chunks: rows.length };
  } catch (err) {
    await sql`UPDATE repos SET status = 'error' WHERE id = ${repoId}`.catch(() => {});
    // Rethrow so BullMQ records the failure and applies its retry policy.
    throw err;
  }
}
