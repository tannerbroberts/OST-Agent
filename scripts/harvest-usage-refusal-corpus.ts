/**
 * Cut the usage-refusal corpus out of a vault's own usage trace.
 *
 * Run by hand, output committed to `test/fixtures/usage-refusals/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for what the rule is.
 *
 *   npx tsx scripts/harvest-usage-refusal-corpus.ts ~/ost-agent-meta test/fixtures/usage-refusals
 *
 * The rule is one line: **every event with `ok: false`, in the order it was
 * appended, with nothing dropped.** No filtering by tool, by message shape, or by
 * whether the census can classify it. A corpus cut to what a classifier can read
 * measures the classifier; the whole point of weighting by what actually fired is
 * that the events were recorded by a process that had no idea this census would
 * be taken over them (`src/telemetry/usage.ts` writes them as calls happen).
 *
 * Successes are counted and written to `corpus.json` but not committed as rows.
 * The census's denominator is refusals, and 7,589 successful calls would be
 * 1.3MB of fixture that no assertion reads.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import type { UsageEvent } from "../src/telemetry/usage.js";

const [, , vaultArg, outArg] = process.argv;
if (!vaultArg || !outArg) {
  console.error("usage: harvest-usage-refusal-corpus.ts <vault-dir> <out-dir>");
  process.exit(2);
}
const vault = path.resolve(vaultArg);
const out = path.resolve(outArg);
const log = path.join(vault, ".ost-agent", "usage", "events.jsonl");

const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const events: UsageEvent[] = [];
let unparseable = 0;
for (const line of lines) {
  try {
    events.push(JSON.parse(line) as UsageEvent);
  } catch {
    // A truncated tail is a real state of an append-only log written fail-open.
    // Counted, never silently dropped: it belongs in the corpus report.
    unparseable++;
  }
}

const refusals = events.filter((e) => e.ok === false);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "refusals.jsonl"),
  refusals
    .map((e) =>
      JSON.stringify({
        ts: e.ts,
        tool: e.tool,
        surface: e.surface,
        err: redactSecrets(e.err ?? ""),
        ...(e.denied ? { denied: true as const } : {}),
        ...(e.session ? { session: e.session } : {}),
      }),
    )
    .join("\n") + "\n",
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  JSON.stringify(
    {
      source: path.relative(path.dirname(vault), log),
      events: events.length,
      refusals: refusals.length,
      unparseableLines: unparseable,
      firstEvent: events[0]?.ts ?? null,
      lastEvent: events[events.length - 1]?.ts ?? null,
      toolsRefused: Object.fromEntries(
        Object.entries(
          refusals.reduce<Record<string, number>>((acc, e) => {
            acc[e.tool] = (acc[e.tool] ?? 0) + 1;
            return acc;
          }, {}),
        ).sort((a, b) => b[1] - a[1]),
      ),
    },
    null,
    2,
  ) + "\n",
);

console.log(`${refusals.length} refusal(s) out of ${events.length} event(s) → ${out}`);
