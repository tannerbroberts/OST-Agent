/**
 * Cut the path-root coverage corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/path-root-coverage/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-path-root-corpus.ts ~/.claude/projects test/fixtures/path-root-coverage \
 *     --exclude <the session that cut this corpus> --slice <session-id>
 *
 * **Both populations are kept, not only the failures.** The assumption test asked
 * for coverage over the successes as well, and it is the only control that catches
 * a vocabulary which merely describes where this machine keeps its work: a root set
 * covering 95% of the paths that worked and 20% of the paths that failed is not a
 * root set that would have prevented anything.
 *
 * The working directory is lifted with every call, because it is the field the
 * whole census turns on and the sibling path-guess corpus records that the
 * transcript does not carry one. It does — `cwd`, on every entry.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { redactSecrets } from "../src/adapters/transcript.js";
import {
  formatPathRootCensus,
  pathRootCoverage,
  readAddressedPaths,
  type AddressedPath,
  type FailedPath,
} from "../src/runner/path-roots.js";
import { classifyPathFailure, MAX_COMMAND_CHARS, MAX_ERROR_CHARS } from "../src/telemetry/path-failure-attribution.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-path-root-corpus.ts <projects-dir> <out-dir> [--exclude <id>]… [--slice <id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id. A count must not include the calls its own construction
 * caused: the session that cuts this corpus spends its life addressing paths in two
 * repositories, which is the exact behaviour being measured.
 */
const excludedSessions: string[] = [];
/** Sessions kept raw, so the reader is exercised against the shape of the real record. */
const slicedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
  else if (rest[i] === "--slice" && rest[i + 1]) slicedSessions.push(rest[++i]);
}

/** Every `.jsonl` under the projects root, at any depth — a subagent's transcript is nested. */
function transcripts(dir: string): string[] {
  const found: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) found.push(...transcripts(full));
    else if (name.endsWith(".jsonl")) found.push(full);
  }
  return found;
}

const files = transcripts(root);
const sessions: TranscriptSession[] = [];
let nested = 0;
for (const file of files) {
  const id = path.basename(file, ".jsonl");
  if (excludedSessions.includes(id)) continue;
  if (path.dirname(path.dirname(file)) !== root) nested++;
  try {
    sessions.push({ id, jsonl: fs.readFileSync(file, "utf8") });
  } catch {
    // an unreadable transcript is one fewer session, and the count below says so
  }
}

const record = readAddressedPaths(sessions);
const census = pathRootCoverage(record);

const redactFailure = (f: FailedPath): FailedPath => ({
  ...f,
  cwd: redactSecrets(f.cwd),
  addressed: redactSecrets(f.addressed),
  error: redactSecrets(f.error),
  command: redactSecrets(f.command),
});
const redactAddressed = (a: AddressedPath): AddressedPath => ({
  ...a,
  cwd: redactSecrets(a.cwd),
  addressed: redactSecrets(a.addressed),
});

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "failures.jsonl"),
  record.failures.map((f) => JSON.stringify(redactFailure(f))).join("\n") + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(out, "successes.jsonl.gz"),
  zlib.gzipSync(record.successes.map((s) => JSON.stringify(redactAddressed(s))).join("\n") + "\n"),
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  JSON.stringify(
    {
      projectsRoot: root,
      transcriptsFound: files.length,
      transcriptsNested: nested,
      excludedSessions,
      sessionsRead: sessions.length,
      calls: record.calls,
      errors: record.errors,
      failedPaths: record.failures.length,
      successPaths: record.successes.length,
      unnamed: record.unnamed,
      notAPath: record.notAPath,
      deniedPaths: record.deniedPaths,
      cdAdjusted: record.cdAdjusted,
      /** How many failing calls carried no working directory at all. */
      failuresWithoutCwd: record.failures.filter((f) => !f.cwd).length,
      maxErrorChars: MAX_ERROR_CHARS,
      maxCommandChars: MAX_COMMAND_CHARS,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

/**
 * Cut a session down to the entries a reader has to get right, kept verbatim.
 *
 * Every entry carrying a tool call that failed with a path-shaped error, every
 * entry carrying one of those results, and the first `keepSuccesses` call/result
 * pairs that worked — so the reader is exercised against the real record's shape,
 * `cwd` field and content-block nesting rather than only against synthetic
 * entries, without committing a 1.5 MB transcript to do it.
 */
function sliceSession(jsonl: string, keepSuccesses: number): string[] {
  const lines = jsonl.split("\n").filter((l) => l.trim());
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
  const blocksOf = (entry: Record<string, unknown> | null): Record<string, unknown>[] => {
    const content = (entry?.message as Record<string, unknown> | undefined)?.content;
    return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
  };

  const keptIds = new Set<string>();
  let successesKept = 0;
  for (const entry of parsed) {
    for (const block of blocksOf(entry)) {
      if (block.type !== "tool_result") continue;
      const id = String(block.tool_use_id ?? "");
      if (!id) continue;
      if (block.is_error === true) {
        const text = Array.isArray(block.content)
          ? (block.content as Record<string, unknown>[]).map((b) => String(b.text ?? "")).join(" ")
          : String(block.content ?? "");
        if (classifyPathFailure(text) !== null) keptIds.add(id);
      } else if (successesKept < keepSuccesses) {
        keptIds.add(id);
        successesKept++;
      }
    }
  }

  const kept: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const touches = blocksOf(parsed[i]).some((b) => {
      if (b.type === "tool_use") return keptIds.has(String(b.id ?? ""));
      if (b.type === "tool_result") return keptIds.has(String(b.tool_use_id ?? ""));
      return false;
    });
    if (touches) kept.push(lines[i]);
  }
  return kept;
}

for (const id of slicedSessions) {
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    console.error(`--slice ${id}: no such session under ${root}`);
    continue;
  }
  const kept = sliceSession(session.jsonl, 12);
  fs.writeFileSync(path.join(out, `${id}.jsonl`), redactSecrets(kept.join("\n")) + "\n", "utf8");
  console.log(`sliced ${id}: ${kept.length} of ${session.jsonl.split("\n").filter(Boolean).length} entries`);
}

console.log(formatPathRootCensus(census));
