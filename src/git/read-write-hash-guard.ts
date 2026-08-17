/**
 * Read-write hash guard.
 *
 * A read hands back the file's content and a fingerprint of it. A write
 * presents that fingerprint back; if the file's current content no longer
 * hashes to it, the write is refused with a message that says *the file
 * changed since you read it* and names what moved — not the generic
 * `String to replace not found in file` a literal-match editor reports when
 * the same drift happens underneath it.
 *
 * Scope, stated once here rather than implied: this guard answers "did the
 * file drift between this read and this write", nothing more. A refusal
 * that is NOT drift — old_string never matched what is actually on disk,
 * even though the hash is unchanged — is a different failure this guard
 * does not touch and does not need to: the hash agreeing IS the answer
 * "not drift", and whatever matches text within that unchanged content is
 * the caller's problem. It also does not say what a caller should do on
 * refusal (re-read, merge, ask) — only that proceeding on the stale read
 * would be wrong.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

export interface ReadWithHash {
  readonly content: string;
  readonly hash: string;
}

export class DriftError extends Error {
  readonly filePath: string;
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(filePath: string, expectedHash: string, actualHash: string, whatDrifted: string) {
    super(`the file changed since you read it: ${filePath} — ${whatDrifted}`);
    this.name = "DriftError";
    this.filePath = filePath;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Read a file, returning its content alongside the fingerprint a later write must present. */
export function readWithHash(filePath: string): ReadWithHash {
  const content = fs.readFileSync(filePath, "utf8");
  return { content, hash: hashContent(content) };
}

/**
 * Write `newContent` to `filePath`, but only if the file's content on disk
 * right now still hashes to `read.hash` — the fingerprint {@link readWithHash}
 * returned for the read this write follows.
 *
 * Throws {@link DriftError} on mismatch, naming what drifted rather than
 * leaving the caller to guess. Never partially writes: the drift check runs
 * before the write, so a refusal leaves the file exactly as it was found.
 */
export function writeWithHash(filePath: string, newContent: string, read: ReadWithHash): void {
  const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const currentHash = hashContent(currentContent);
  if (currentHash !== read.hash) {
    throw new DriftError(filePath, read.hash, currentHash, describeDrift(read.content, currentContent));
  }
  fs.writeFileSync(filePath, newContent, "utf8");
}

/**
 * Name what moved between two versions of the same file, in one line: the
 * first line where they diverge, how many lines differ, and a short preview
 * of what was there and what replaced it. Deliberately not a full diff — the
 * point is a caller can read the refusal and know where to look, not that it
 * reproduces `diff -u`.
 */
function describeDrift(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let head = 0;
  while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) head++;

  let tail = 0;
  const maxTail = Math.min(beforeLines.length - head, afterLines.length - head);
  while (
    tail < maxTail &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  ) {
    tail++;
  }

  const removed = beforeLines.slice(head, beforeLines.length - tail);
  const added = afterLines.slice(head, afterLines.length - tail);
  const lineNo = head + 1;

  if (removed.length === 0 && added.length === 0) {
    // Same lines, different bytes (e.g. line-ending or trailing-whitespace churn).
    return `content differs starting at byte ${firstByteDiff(before, after)}, though every line matches`;
  }

  const preview = (lines: readonly string[]) =>
    lines
      .slice(0, 2)
      .map((l) => JSON.stringify(l.length > 80 ? l.slice(0, 80) + "…" : l))
      .join(", ");

  return (
    `around line ${lineNo}, ${removed.length} line(s) became ${added.length} line(s)` +
    (removed.length ? ` — was ${preview(removed)}` : " — was nothing (an insertion)") +
    (added.length ? `, now ${preview(added)}` : ", now nothing (a deletion)")
  );
}

function firstByteDiff(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}
