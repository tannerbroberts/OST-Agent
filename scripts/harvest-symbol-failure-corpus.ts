/**
 * Cut the symbol-failure corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/symbol-failure/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for what the rule is and
 * what it deliberately leaves out.
 *
 *   npx tsx scripts/harvest-symbol-failure-corpus.ts ~/.claude/projects test/fixtures/symbol-failure \
 *     --exclude <session-id> --slice <session-id>
 *
 * Both halves are written. `resolutions.jsonl` carries every failure a compiler
 * produced together with the repair the session made for it; `citations.jsonl`
 * carries every symbol error that reached a run *without* a compiler having just
 * produced it, because on this corpus that bucket is three times the size of the
 * one being counted and a census that hid it would be reporting an echo.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { resolveSymbolFailures, SYMBOL_FAILURE_RULE, type ResolvedFailure } from "../src/telemetry/symbol-failure.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-symbol-failure-corpus.ts <projects-dir> <out-dir> [--exclude <id>]… [--slice <id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id. A count must not include the failures its own
 * construction caused, and this census's own session is worse than most: it
 * greps the transcript corpus for the very error strings it is counting, so
 * every one of its results is a citation it would then have to classify.
 */
const excludedSessions: string[] = [];
/**
 * Sessions cut down to the entries that carry a failure and its repair, committed
 * as raw `.jsonl` so the reader is exercised against the shape of the real record
 * rather than only against synthetic entries.
 */
const slicedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
  else if (rest[i] === "--slice" && rest[i + 1]) slicedSessions.push(rest[++i]);
}

/** Every `.jsonl` under the projects root, at any depth — worktrees nest. */
function transcripts(dir: string): string[] {
  const found: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...transcripts(full));
    else if (entry.name.endsWith(".jsonl")) found.push(full);
  }
  return found.sort();
}

const files = transcripts(root);
const sessions: TranscriptSession[] = [];
for (const file of files) {
  const id = path.basename(file, ".jsonl");
  if (excludedSessions.includes(id)) continue;
  try {
    sessions.push({ id, jsonl: fs.readFileSync(file, "utf8") });
  } catch {
    // an unreadable transcript is one fewer session, and the count below says so
  }
}

const { classified, cited, errorsSeen } = resolveSymbolFailures(sessions);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "resolutions.jsonl"),
  classified.map((failure) => JSON.stringify(redact(failure))).join("\n") + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(out, "citations.jsonl"),
  cited.map((citation) => JSON.stringify({ ...citation, subject: redactSecrets(citation.subject) })).join("\n") + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  JSON.stringify(
    {
      projectsRoot: root,
      transcriptsFound: files.length,
      excludedSessions,
      sessionsRead: sessions.length,
      errorsSeen,
      failures: classified.length,
      citedResults: cited.length,
      citedErrors: cited.reduce((total, citation) => total + citation.errors, 0),
      bar: SYMBOL_FAILURE_RULE.bar,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

for (const id of slicedSessions) {
  const session = sessions.find((candidate) => candidate.id === id);
  if (!session) {
    console.error(`--slice ${id}: no such session under ${root}`);
    continue;
  }
  const kept = sliceToSymbolFailures(session);
  fs.writeFileSync(path.join(out, `${id}.jsonl`), kept.join("\n") + "\n", "utf8");
  console.log(`sliced ${id}: ${kept.length} entries`);
}

const cells = new Map<string, number>();
for (const failure of classified) cells.set(failure.resolution, (cells.get(failure.resolution) ?? 0) + 1);
console.log(
  `${sessions.length} transcripts, ${errorsSeen} symbol errors, ${classified.length} produced by a compiler, ` +
    `${cited.length} cited back; ` +
    [...cells.entries()].map(([name, count]) => `${name} ${count}`).join(", "),
);

function redact(failure: ResolvedFailure): ResolvedFailure {
  return {
    ...failure,
    command: redactSecrets(failure.command),
    message: redactSecrets(failure.message),
    evidence: redactSecrets(failure.evidence),
  };
}

/**
 * The entries of one session that carry a symbol failure a compiler produced, the
 * call that produced it, and the edit that repaired it — verbatim apart from
 * `redactSecrets`, in original order, with their original indices preserved by
 * padding the gaps with blank lines.
 *
 * The padding is what makes the slice usable: `classifyResolution` walks forward
 * from `failure.entry`, so an entry index that shifted would point the reader at
 * the wrong edit and quietly change the classification.
 */
function sliceToSymbolFailures(session: TranscriptSession): string[] {
  const lines = session.jsonl.split("\n");
  const { classified: own } = resolveSymbolFailures([session]);
  const wanted = new Set<number>();

  for (const failure of own) {
    wanted.add(failure.entry);
    const repaired = /e(\d+)$/.exec(failure.resolvedBy);
    if (repaired) wanted.add(Number(repaired[1]));
  }
  // The `tool_use` that produced each kept `tool_result`, so the command that ran
  // the compiler travels with its output.
  const callLine = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_use" && typeof block.id === "string") callLine.set(block.id, i);
      if (block.type !== "tool_result" || !wanted.has(i)) continue;
      const at = callLine.get(String(block.tool_use_id ?? ""));
      if (at !== undefined) wanted.add(at);
    }
  }

  const last = Math.max(...wanted);
  const kept: string[] = [];
  for (let i = 0; i <= last; i++) kept.push(wanted.has(i) ? redactSecrets(lines[i].trim()) : "");
  return kept;
}
