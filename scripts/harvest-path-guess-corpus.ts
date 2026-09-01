/**
 * Cut the path-guess hit-rate corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/path-guess-hit-rate/`. It exists
 * so the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-path-guess-corpus.ts ~/.claude/projects test/fixtures/path-guess-hit-rate \
 *     --exclude <the session that cut this corpus> --slice <session-id>
 *
 * **Every call is kept, not only the path-taking ones and not only the failures.**
 * This census's denominator is *successes*, which is the whole reason it cannot be
 * run over this product's own friction records: those hold failures only, and a
 * hit rate over them is 100% by construction. Dropping the boring bulk here would
 * reproduce that mistake in the cut instead of in the classifier.
 *
 * The one thing that is dropped is observation tokens no call in that session ever
 * addresses. That is a lossless compression of the replay — a token nothing
 * addresses cannot change any call's verdict — and this script proves it rather
 * than asserting it: the census is computed twice, once over the full token stream
 * and once over the filtered one, and both hit rates go into `corpus.json`. If a
 * future re-cut makes them differ, the fixture is wrong and the number is an
 * artefact of it.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { redactSecrets } from "../src/adapters/transcript.js";
import {
  formatPathGuessCensus,
  GUESS_RULE,
  pathGuessCensus,
  readSessionStreams,
  type SessionStream,
  type StreamEvent,
} from "../src/telemetry/path-guess-hit-rate.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-path-guess-corpus.ts <projects-dir> <out-dir> [--exclude <id>]… [--slice <id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id. A count must not include the calls its own
 * construction caused: the session that cuts this corpus spends its life
 * addressing paths in two repositories, which is the exact behaviour being
 * measured.
 */
const excludedSessions: string[] = [];
/**
 * Sessions kept raw as `.jsonl`, so the reader is exercised against the shape of
 * the real record rather than only against synthetic entries.
 */
const slicedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
  else if (rest[i] === "--slice" && rest[i + 1]) slicedSessions.push(rest[++i]);
}

/**
 * Every `.jsonl` under the projects root, **at any depth**. Depth is load-bearing:
 * a subagent's transcript lands under `<project>/subagents/**`, and more than half
 * this machine's record is nested.
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

const filtered = readSessionStreams(sessions, { relevantOnly: true });
const full = readSessionStreams(sessions, { relevantOnly: false });

const redacted: SessionStream[] = filtered.streams.map((s) => ({
  session: s.session,
  events: s.events.map(redactEvent),
}));

const censusFiltered = pathGuessCensus(redacted, {
  sessionsRead: filtered.sessionsRead,
  calls: filtered.calls,
});
const censusFull = pathGuessCensus(
  full.streams.map((s) => ({ session: s.session, events: s.events.map(redactEvent) })),
  { sessionsRead: full.sessionsRead, calls: full.calls },
);

fs.mkdirSync(out, { recursive: true });
// Gzipped for the same reason the shell-necessity corpus is: the honest
// denominator is every call, which is ~10 MB plain and a tenth of that
// compressed. The census reads it back with `zlib`.
fs.writeFileSync(
  path.join(out, "streams.jsonl.gz"),
  zlib.gzipSync(Buffer.from(redacted.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8"), { level: 9 }),
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  JSON.stringify(
    {
      projectsRoot: root,
      transcriptsFound: files.length,
      transcriptsNested: nested,
      excludedSessions,
      sessionsRead: filtered.sessionsRead,
      calls: filtered.calls,
      bar: GUESS_RULE.bar,
      maxErrorChars: 800,
      maxCommandChars: 600,
      // The compression proof: filtering irrelevant observation tokens must not
      // move a single count, or the fixture decided the number instead of the rule.
      firstContactFiltered: censusFiltered.primary.firstContact,
      firstContactUnfiltered: censusFull.primary.firstContact,
      wrongGuessesFiltered: censusFiltered.primary.wrongGuesses,
      wrongGuessesUnfiltered: censusFull.primary.wrongGuesses,
      observationTokensFiltered: countTokens(filtered.streams),
      observationTokensUnfiltered: countTokens(full.streams),
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
  const lines = session.jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(redactSecrets);
  fs.writeFileSync(path.join(out, `${id}.jsonl`), lines.join("\n") + "\n", "utf8");
  console.log(`sliced ${id}: ${lines.length} entries`);
}

console.log(`${filtered.sessionsRead} transcripts (${nested} nested), ${filtered.calls} calls`);
console.log(formatPathGuessCensus(censusFiltered));

function countTokens(streams: SessionStream[]): number {
  let n = 0;
  for (const s of streams) for (const e of s.events) if (e.kind === "observe") n += e.tokens.length;
  return n;
}

function redactEvent(event: StreamEvent): StreamEvent {
  if (event.kind === "observe") return { kind: "observe", tokens: event.tokens.map(redactSecrets) };
  return {
    ...event,
    command: redactSecrets(event.command),
    declaredPath: redactSecrets(event.declaredPath),
    error: redactSecrets(event.error),
  };
}
