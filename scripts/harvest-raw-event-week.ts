/**
 * Cut one week of RAW usage events out of a vault's own trace.
 *
 * Run by hand, output committed to `test/fixtures/raw-event-week/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for what the rule is.
 *
 *   npx tsx scripts/harvest-raw-event-week.ts ~/ost-agent-meta test/fixtures/raw-event-week
 *
 * The rule is two lines. **The last seven UTC days that had already finished when
 * the cut was taken, and every event inside them, in append order.** No filtering
 * by tool, by surface, by outcome, or by whether a question below can be answered
 * from it. That matters more here than usual: the claim the fixture is evidence
 * for is that raw retention answers questions a summary cannot, and a week chosen
 * because it answers them would be the fixture answering, not the retention.
 *
 * Unlike `harvest-usage-refusal-corpus.ts`, nothing is dropped from a kept day and
 * no field is projected away. A raw-first store's fixture that had already been
 * summarised would be a contradiction in terms.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import type { UsageEvent } from "../src/telemetry/usage.js";

const [, , vaultArg, outArg, asOfArg] = process.argv;
if (!vaultArg || !outArg) {
  console.error("usage: harvest-raw-event-week.ts <vault-dir> <out-dir> [as-of-YYYY-MM-DD]");
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

/** The day the cut was taken. Its own events are excluded: a partial day is not a day. */
const asOf = asOfArg ?? new Date().toISOString().slice(0, 10);
const dayBefore = (day: string, back: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) - back * 86_400_000).toISOString().slice(0, 10);

/** Seven consecutive dates, not seven dates that happen to have events in them. */
const window = Array.from({ length: 7 }, (_, i) => dayBefore(asOf, 7 - i));
const first = window[0];
const last = window[window.length - 1];

const kept = events.filter((e) => {
  const day = typeof e.ts === "string" ? e.ts.slice(0, 10) : "";
  return day >= first && day <= last;
});

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "events.jsonl"), kept.map((e) => JSON.stringify(e)).join("\n") + "\n");

const perDay = Object.fromEntries(window.map((day) => [day, kept.filter((e) => e.ts.slice(0, 10) === day).length]));

fs.writeFileSync(
  path.join(out, "week.json"),
  JSON.stringify(
    {
      source: path.relative(path.dirname(vault), log),
      cutAsOf: asOf,
      window: { first, last, days: window },
      traceEvents: events.length,
      unparseableLines: unparseable,
      weekEvents: kept.length,
      perDay,
      firstEvent: kept[0]?.ts ?? null,
      lastEvent: kept[kept.length - 1]?.ts ?? null,
    },
    null,
    2,
  ) + "\n",
);

console.log(`${kept.length} event(s) across ${first}..${last} out of ${events.length} in the trace → ${out}`);
