// Heuristic code chunker. Splits on top-level declaration boundaries where it
// can recognise them, then enforces a hard size ceiling with overlap. This is
// deliberately regex-based rather than AST-based: tree-sitter would need a
// grammar per language for a marginal gain over "split at column-0 declarations".

/** ~512 tokens. Code averages roughly 3 chars/token, hence ~1800 chars. */
const MAX_CHUNK_CHARS = 1800;
/** ~50 tokens of overlap so a declaration split across chunks stays findable. */
const OVERLAP_CHARS = 150;
/** Segments below this get merged forward — a 3-line chunk embeds poorly. */
const MIN_CHUNK_CHARS = 200;

export interface Chunk {
  chunkIndex: number;
  text: string;
  /** Declared symbol this chunk opens with, when one was recognised. */
  symbolName?: string;
}

// ─── Declaration recognition ──────────────────────────────────────────────────
// Anchored at column 0 (or near it) so nested declarations don't fragment the
// enclosing scope into useless slivers.

const DECLARATION_PATTERNS: RegExp[] = [
  // TS/JS
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\(|function|<)/,
  // Python
  /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/,
  /^class\s+([A-Za-z_][\w]*)/,
  // Go
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/,
  // Rust
  /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/,
  /^(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_][\w]*)/,
];

function matchDeclaration(line: string): string | null {
  for (const re of DECLARATION_PATTERNS) {
    const m = line.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

interface Segment {
  text: string;
  symbolName?: string;
}

// ─── Splitting strategies ─────────────────────────────────────────────────────

function splitByDeclarations(content: string): Segment[] {
  const lines = content.split("\n");
  const segments: Segment[] = [];

  let current: string[] = [];
  let currentSymbol: string | undefined;

  for (const line of lines) {
    const symbol = matchDeclaration(line);

    // Start a new segment at a declaration, but only if we've accumulated
    // something — otherwise consecutive declarations each become their own
    // one-line segment (the merge pass would just undo that).
    if (symbol && current.length > 0) {
      segments.push({ text: current.join("\n"), symbolName: currentSymbol });
      current = [];
      currentSymbol = symbol;
    } else if (symbol && currentSymbol === undefined) {
      currentSymbol = symbol;
    }

    current.push(line);
  }

  if (current.length > 0) {
    segments.push({ text: current.join("\n"), symbolName: currentSymbol });
  }

  return segments;
}

/** Markdown chunks far better on heading boundaries than on code declarations. */
function splitMarkdown(content: string): Segment[] {
  const lines = content.split("\n");
  const segments: Segment[] = [];

  let current: string[] = [];
  let currentHeading: string | undefined;

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m && current.length > 0) {
      segments.push({ text: current.join("\n"), symbolName: currentHeading });
      current = [];
      currentHeading = m[2].trim();
    } else if (m && currentHeading === undefined) {
      currentHeading = m[2].trim();
    }
    current.push(line);
  }

  if (current.length > 0) {
    segments.push({ text: current.join("\n"), symbolName: currentHeading });
  }

  return segments;
}

/**
 * Enforces MAX_CHUNK_CHARS, preferring line boundaries and carrying ~OVERLAP_CHARS
 * of trailing context into the next piece.
 */
function hardSplit(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const lines = text.split("\n");
  const out: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    // Pathological single line (minified leftovers, giant string literals):
    // fall back to a raw character split.
    if (line.length > MAX_CHUNK_CHARS) {
      if (current.length > 0) {
        out.push(current.join("\n"));
        current = [];
        currentLen = 0;
      }
      for (let i = 0; i < line.length; i += MAX_CHUNK_CHARS) {
        out.push(line.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }

    if (currentLen + line.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
      out.push(current.join("\n"));

      // Seed the next chunk with the tail of this one.
      const overlap: string[] = [];
      let overlapLen = 0;
      for (let i = current.length - 1; i >= 0 && overlapLen < OVERLAP_CHARS; i--) {
        overlap.unshift(current[i]);
        overlapLen += current[i].length + 1;
      }
      current = overlap;
      currentLen = overlapLen;
    }

    current.push(line);
    currentLen += line.length + 1;
  }

  if (current.length > 0) out.push(current.join("\n"));
  return out.filter((s) => s.trim().length > 0);
}

/** Merges undersized segments forward, then applies the size ceiling. */
function normalize(segments: Segment[]): Chunk[] {
  // Merge pass — accumulate until we clear MIN_CHUNK_CHARS.
  const merged: Segment[] = [];
  let pending: Segment | null = null;

  for (const seg of segments) {
    if (seg.text.trim().length === 0) continue;

    if (pending === null) {
      pending = { ...seg };
    } else if (pending.text.length < MIN_CHUNK_CHARS) {
      pending = {
        text: `${pending.text}\n${seg.text}`,
        // Keep the first recognised symbol — it's the one the chunk opens with.
        symbolName: pending.symbolName ?? seg.symbolName,
      };
    } else {
      merged.push(pending);
      pending = { ...seg };
    }
  }
  if (pending !== null) merged.push(pending);

  // Size pass — split anything still oversized, inheriting the symbol name.
  const chunks: Chunk[] = [];
  for (const seg of merged) {
    for (const piece of hardSplit(seg.text)) {
      chunks.push({
        chunkIndex: chunks.length,
        text: piece,
        symbolName: seg.symbolName,
      });
    }
  }

  return chunks;
}

export function chunkFile(content: string, relPath: string): Chunk[] {
  const isMarkdown = /\.mdx?$/i.test(relPath);
  const segments = isMarkdown ? splitMarkdown(content) : splitByDeclarations(content);
  return normalize(segments);
}

// ─── Contextual header ────────────────────────────────────────────────────────

/**
 * Builds the text that actually gets embedded: a provenance header plus the code.
 *
 * This is the single biggest retrieval-quality lever. A bare `function handleSubmit()`
 * chunk embeds nearly identically whether it came from LoginForm.tsx or
 * CheckoutForm.tsx; the header gives the model lexical signal about the domain, so
 * "where is auth handled" can match on the path even when the body never says "auth".
 *
 * Note this is NOT what gets stored in `chunk_text` — the pure code is stored, and
 * the path already lives in the `file_path` column. Persisting the header too would
 * feed the path to Phase 4 agents twice.
 */
export function buildEmbedText(relPath: string, chunk: Chunk): string {
  const header = chunk.symbolName
    ? `// File: ${relPath}, Symbol: ${chunk.symbolName}`
    : `// File: ${relPath}`;
  return `${header}\n${chunk.text}`;
}
