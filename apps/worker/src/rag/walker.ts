import fs from "node:fs/promises";
import path from "node:path";

// ─── Exclusion rules ──────────────────────────────────────────────────────────
// Skipping aggressively here is cheaper than filtering downstream: minified and
// generated files are the most likely source of oversized chunks, and embedding
// them costs money while polluting retrieval with noise.

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "target",        // rust / java
  "vendor",        // go / php
  "__pycache__",
  ".venv",
  "venv",
  "site-packages",
  ".turbo",
  ".cache",
]);

const SKIP_FILE_PATTERNS: RegExp[] = [
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.d\.ts$/i,          // generated for app repos; see note below
  /\.snap$/i,           // jest snapshots
  /^bun\.lock(b)?$/i,
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /^poetry\.lock$/i,
  /^Cargo\.lock$/i,
];

// NOTE on .d.ts: correct to skip for application repos where they are build
// output. If DevMind is ever pointed at a *library*, the .d.ts IS the public
// API surface and excluding it would lose the most useful signal in the repo.

const ALLOWED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".java", ".rs", ".rb", ".php",
  ".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".swift", ".kt",
  ".md", ".mdx", ".json", ".yaml", ".yml", ".toml",
  ".css", ".scss", ".html", ".vue", ".svelte", ".sql",
]);

const MAX_FILE_BYTES = 1_000_000; // 1 MB

export interface WalkedFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the repo root, always POSIX-separated. */
  relPath: string;
  content: string;
}

function shouldSkipFile(fileName: string): boolean {
  return SKIP_FILE_PATTERNS.some((re) => re.test(fileName));
}

/**
 * Recursively collects indexable source files under `root`.
 * Unreadable files and anything failing the filters are silently skipped —
 * one bad file should never abort an entire repo index.
 */
export async function walkRepo(root: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than fail the job
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldSkipFile(entry.name)) continue;
      if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        if (stat.size === 0) continue;

        const content = await fs.readFile(full, "utf8");
        // Heuristic binary guard: real source never contains NUL bytes.
        if (content.includes("\u0000")) continue;

        out.push({
          absPath: full,
          relPath: path.relative(root, full).split(path.sep).join("/"),
          content,
        });
      } catch {
        continue; // unreadable file — skip
      }
    }
  }

  await walk(root);
  return out;
}
