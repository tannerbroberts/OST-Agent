/**
 * Cut the shell-necessity corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/shell-necessity/`. It exists
 * so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-shell-necessity-corpus.ts ~/.claude/projects test/fixtures/shell-necessity \
 *     --exclude <the session that cut this corpus>
 *
 * **Every command is kept, not only the interesting ones.** The census's claim
 * is a share, and a share is only as honest as its denominator: `git status`
 * repeated four hundred times weighs exactly what it cost, and dropping the
 * boring bulk would decide the number in the cut instead of in the classifier.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { redactSecrets } from "../src/adapters/transcript.js";
import {
  formatShellNecessityCensus,
  readBashCommands,
  shellNecessityCensus,
} from "../src/runner/shell-necessity.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-shell-necessity-corpus.ts <projects-dir> <out-dir> [--exclude <session-id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id: the one that cut this corpus types shell probes and
 * quotes the failing forms back to itself while writing the classifier, and a
 * census must not count the commands its own construction caused.
 */
const excludedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
}

/**
 * Every `.jsonl` under the projects root, **at any depth**. Depth is
 * load-bearing, not tidiness: a subagent's transcript lands under
 * `<project>/subagents/**`, and more than half this machine's record is nested.
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

const { commands, invocations } = readBashCommands(sessions);
const redacted = commands.map((c) => ({ ...c, command: redactSecrets(c.command) }));
const census = shellNecessityCensus(redacted, { sessionsRead: sessions.length });

fs.mkdirSync(out, { recursive: true });
// Gzipped because the honest denominator is every command: ~14k distinct texts
// are 5 MB plain and 1.1 MB compressed, and the census reads it back with zlib.
fs.writeFileSync(
  path.join(out, "commands.jsonl.gz"),
  zlib.gzipSync(Buffer.from(redacted.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8"), { level: 9 }),
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
      distinctCommands: redacted.length,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

console.log(`${sessions.length} transcripts (${nested} nested), ${invocations} Bash invocations, ${redacted.length} distinct`);
console.log(formatShellNecessityCensus(census));
