/**
 * Cut the safe-form coverage corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/safe-form-coverage/`. It exists
 * so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-safe-form-corpus.ts ~/.claude/projects test/fixtures/safe-form-coverage \
 *     --exclude <the session that cut this corpus>
 *
 * **Every command is kept, not only the ones that failed.** The census makes two
 * claims and both are shares: one over all commands and one over the failing
 * ones. A cut that kept only the interesting commands would decide the first
 * number in the selection instead of in the classifier, so `git status` repeated
 * four hundred times weighs exactly what it cost.
 *
 * What distinguishes this corpus from `test/fixtures/shell-necessity/` — the same
 * commands, cut by the same walk — is the **outcome** of each invocation. That
 * one is aggregated by text alone; this one pairs every `tool_use` back to its
 * `tool_result` and records how many invocations of each text came back
 * `is_error`. The failing bar cannot be read off the other fixture at all.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { redactSecrets } from "../src/adapters/transcript.js";
import { formatSafeFormCoverage, readBashOutcomes, safeFormCoverageCensus } from "../src/knowledge/safe-forms.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-safe-form-corpus.ts <projects-dir> <out-dir> [--exclude <session-id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id: the one that cut this corpus reads the recorded
 * failures back to itself and runs probes against the classifier while writing
 * it, and a census must not count the commands its own construction caused.
 */
const excludedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
}

/**
 * Every `.jsonl` under the projects root, **at any depth**. Depth is
 * load-bearing, not tidiness: a subagent's transcript lands under
 * `<project>/subagents/**`, and a large share of this machine's record is nested.
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

const { commands, invocations, failures, unpaired } = readBashOutcomes(sessions);
const redacted = commands.map((c) => ({ ...c, command: redactSecrets(c.command) }));
const census = safeFormCoverageCensus(redacted, { sessionsRead: sessions.length });

fs.mkdirSync(out, { recursive: true });
// Gzipped for the same reason the sibling corpus is: the honest denominator is
// every command, and the census reads it back with zlib.
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
      failingInvocations: failures,
      unpairedInvocations: unpaired,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

console.log(
  `${sessions.length} transcripts (${nested} nested), ${invocations} Bash invocations, ` +
    `${redacted.length} distinct, ${failures} failed, ${unpaired} unpaired`,
);
console.log(formatSafeFormCoverage(census));
