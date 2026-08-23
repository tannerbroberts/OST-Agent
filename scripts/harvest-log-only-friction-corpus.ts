/**
 * Cut the log-only-friction corpus out of a real OST vault.
 *
 * Run by hand, output committed to `test/fixtures/log-only-friction/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for what the rule is and what
 * it deliberately leaves out.
 *
 *   npx tsx scripts/harvest-log-only-friction-corpus.ts ~/ost-agent-meta \
 *     test/fixtures/log-only-friction --last-day 2026-08-23
 *
 * Two records are taken from the same vault over the same window: the machine trace
 * (`.ost-agent/usage/events.jsonl`) and the transcript channel's already-harvested
 * account of the same friction (`.ost-agent/evidence/TRANSCRIPT_*.md`). The census in
 * `test/telemetry/log-only-friction-recall.test.ts` scores the first against the
 * second.
 *
 * EVERY event is kept, not only the failing ones. A derivation tuned to answer
 * "recurring friction" to everything would sail through a corpus made of positives,
 * and the 6,000-odd successful calls are the only thing that catches it.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readKnownFriction, windowEndingOn } from "../src/telemetry/log-only-friction.js";
import type { UsageEvent } from "../src/telemetry/usage.js";

const [, , vaultArg, outArg, ...rest] = process.argv;
if (!vaultArg || !outArg) {
  console.error("usage: harvest-log-only-friction-corpus.ts <vault-dir> <out-dir> [--last-day YYYY-MM-DD]");
  process.exit(2);
}
const vault = path.resolve(vaultArg);
const out = path.resolve(outArg);

const lastDayFlag = rest.indexOf("--last-day");
const lastDay = lastDayFlag >= 0 ? rest[lastDayFlag + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
  console.error(`--last-day must be YYYY-MM-DD, got ${lastDay}`);
  process.exit(2);
}
const window = windowEndingOn(lastDay);

/**
 * The trace fields the census reads, and only those.
 *
 * `wrote`, `lost`, `dropped` and `ms` are dropped on the way out — no part of this
 * census reads them, and `wrote` carries node filenames that would put a slice of
 * one vault's tree into this repository's fixtures for nothing. Committing a field
 * the census cannot read would also invite a later census to read it, at which point
 * the fixture would be answering a question it was never cut for.
 */
function slim(e: UsageEvent): Record<string, unknown> {
  return {
    ts: e.ts,
    tool: e.tool,
    ok: e.ok,
    surface: e.surface,
    argBytes: e.argBytes,
    ...(e.err ? { err: redactSecrets(e.err) } : {}),
    ...(e.denied ? { denied: true } : {}),
    ...(e.session ? { session: e.session } : {}),
  };
}

const tracePath = path.join(vault, ".ost-agent", "usage", "events.jsonl");
const raw = fs.readFileSync(tracePath, "utf8").split("\n").filter((l) => l.trim());
let torn = 0;
const events: UsageEvent[] = [];
for (const line of raw) {
  try {
    const parsed = JSON.parse(line) as UsageEvent;
    if (typeof parsed.ts === "string" && typeof parsed.tool === "string") events.push(parsed);
    else torn += 1;
  } catch {
    torn += 1;
  }
}
const inWindow = events.filter((e) => e.ts.slice(0, 10) >= window.from && e.ts.slice(0, 10) <= window.to);

const evidenceDir = path.join(vault, ".ost-agent", "evidence");
const known = readKnownFriction(evidenceDir);
const knownInWindow = known.events.filter(
  (e) => e.timestamp.slice(0, 10) >= window.from && e.timestamp.slice(0, 10) <= window.to,
);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "trace.jsonl"),
  `${inWindow.map((e) => JSON.stringify(slim(e))).join("\n")}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(out, "known-friction.jsonl"),
  `${knownInWindow.map((e) => JSON.stringify({ ...e, detail: redactSecrets(e.detail) })).join("\n")}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  `${JSON.stringify(
    {
      vault,
      lastDay,
      window,
      traceLines: raw.length,
      traceTorn: torn,
      traceEventsInWindow: inWindow.length,
      traceEventsOutsideWindow: events.length - inWindow.length,
      evidenceItemsRead: known.coverage.items,
      knownEventsDeclared: known.coverage.declared,
      knownEventsShown: known.coverage.events,
      knownEventsInWindow: knownInWindow.length,
    },
    null,
    1,
  )}\n`,
  "utf8",
);

console.log(
  `trace: ${inWindow.length} event(s) in ${window.from}…${window.to} (${events.length - inWindow.length} outside, ${torn} torn)\n` +
    `known: ${knownInWindow.length} friction event(s) from ${known.coverage.items} evidence item(s) ` +
    `(${known.coverage.declared} declared, ${known.coverage.events} shown)`,
);
