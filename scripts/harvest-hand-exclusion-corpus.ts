/**
 * Cut the hand-exclusion corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/hand-exclusion/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-hand-exclusion-corpus.ts ~/.claude/projects test/fixtures/hand-exclusion \
 *     --exclude <the session that cut this corpus> --slice <session-id>…
 *
 * **Every exclusion is kept, not only the test-shaped ones.** The census's
 * negative direction is the half that carries it: `rsync --exclude node_modules`,
 * `grep --exclude-dir=dist` and a harvest script excluding its own session are
 * all in the record, and a classifier that answered "quarantined test" to
 * everything would sail through a corpus that held only the positives.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readHandExclusions } from "../src/telemetry/hand-exclusion.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";
import { SHELL_UNREADABLE, shellWords } from "../src/telemetry/shell.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-hand-exclusion-corpus.ts <projects-dir> <out-dir> [--exclude <session-id>]… [--slice <session-id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id. A count must not include the exclusions its own
 * construction caused, and this one would: the session that cut this corpus
 * types `--exclude` into probes all afternoon, and quotes the real commands
 * back to itself while writing the census.
 */
const excludedSessions: string[] = [];
/**
 * Sessions cut down to their exclusion-bearing entries and committed as raw
 * `.jsonl`, so the reader is exercised against the shape of the real record
 * rather than only against synthetic entries.
 */
const slicedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
  else if (rest[i] === "--slice" && rest[i + 1]) slicedSessions.push(rest[++i]);
}

/**
 * Every `.jsonl` under the projects root, **at any depth**. Depth is load-bearing
 * here, not tidiness: a subagent's transcript lands under `<project>/subagents/**`,
 * and three of the four distinct test files this census counts were excluded by a
 * subagent. A one-level read finds one file and reports the census red.
 */
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
  return found.sort();
}

const files = transcripts(root);
const nested = files.filter((f) => path.relative(root, f).split(path.sep).length > 2).length;
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

const { exclusions, unread, invocations, narrowed } = readHandExclusions(sessions);

/**
 * The bound check, run here rather than asserted in the test, because only this
 * script has the unclipped text. The unread bucket is 14% of the runner traffic,
 * so the question that decides whether the count is safe is whether an exclusion
 * could be hiding in it. Exactly one unreadable command contains `--exclude`, and
 * it is a `gh pr create --body "$(cat <<EOF …)"` whose prose quotes a command that
 * was never run — see PROVENANCE.md.
 */
let unreadableMentioningExclude = 0;
for (const session of sessions) {
  for (const line of session.jsonl.split("\n")) {
    if (!line.trim() || !/vitest|jest/.test(line)) continue;
    let entry: { message?: { content?: unknown } };
    try {
      entry = JSON.parse(line) as { message?: { content?: unknown } };
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      const command = (block.input as Record<string, unknown> | undefined)?.command;
      if (typeof command !== "string" || !/\b(vitest|jest)\b/.test(command)) continue;
      if (!SHELL_UNREADABLE.test(command) && shellWords(command)) continue;
      if (/--exclude|--testPathIgnorePattern/.test(command)) unreadableMentioningExclude++;
    }
  }
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "exclusions.jsonl"),
  exclusions.map((e) => JSON.stringify({ ...e, command: redactSecrets(e.command) })).join("\n") + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(out, "unread-invocations.jsonl"),
  unread.map((u) => JSON.stringify({ ...u, command: redactSecrets(u.command) })).join("\n") + "\n",
  "utf8",
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
      invocations,
      narrowed,
      unread: unread.length,
      unreadableMentioningExclude,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

for (const id of slicedSessions) {
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    console.error(`--slice ${id}: no such session under ${root}`);
    continue;
  }
  const kept = sliceToExclusions(session);
  // A subagent's transcript is nested in the real record, and the fixture keeps it
  // nested — the census's headline turns on those files being found at all.
  const at = id.startsWith("agent-") ? path.join(out, "subagents", `${id}.jsonl`) : path.join(out, `${id}.jsonl`);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.writeFileSync(at, kept.join("\n") + "\n", "utf8");
  console.log(`sliced ${id}: ${kept.length} entries → ${path.relative(out, at)}`);
}

console.log(
  `${sessions.length} transcripts (${nested} nested), ${invocations} runner invocations, ` +
    `${exclusions.length} exclusions, ${unread.length} unread`,
);

/** The entries of one session that carry a runner exclusion, verbatim apart from `redactSecrets`. */
function sliceToExclusions(session: TranscriptSession): string[] {
  const lines = session.jsonl.split("\n").filter((l) => l.trim());
  const kept: string[] = [];
  for (const line of lines) {
    const single: TranscriptSession = { id: session.id, jsonl: line };
    if (readHandExclusions([single]).exclusions.length > 0) kept.push(redactSecrets(line.trim()));
  }
  return kept;
}
