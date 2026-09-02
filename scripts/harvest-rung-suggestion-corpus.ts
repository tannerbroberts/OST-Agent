/**
 * Cut the rung-suggestion corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/rung-suggestion/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for what the rule is and
 * what it deliberately leaves out.
 *
 *   npx tsx scripts/harvest-rung-suggestion-corpus.ts ~/.claude/projects test/fixtures/rung-suggestion
 *
 * The rule, in one sentence: keep every session anywhere under the projects
 * directory that contains a rung refusal, cut to the entries carrying a
 * rung-declaring call or its result, from the first such call through the window
 * a retry could still arrive in.
 *
 * **The window is the number that matters.** `RUNG_SUGGESTION_RULE.retryWindowCalls`
 * bounds how far after a refusal a later declaration still counts as its retry, so
 * the cut keeps forward until that many rung-declaring calls have gone by (or the
 * session ends). A narrower cut would drop a retry the caller made and report it
 * as a refusal nobody answered — the one direction this census must not be able
 * to fail in, because unanswered refusals are counted neither way and a dropped
 * retry would silently shrink the denominator instead of showing up as a wrong
 * number.
 *
 * **Entries the census never reads are dropped, and that is the whole size
 * budget.** Keeping every entry across the window produced 2.3 MB of assistant
 * prose and thinking blocks to carry ten refusals; the census indexes
 * rung-declaring calls rather than entries, so removing the rest is lossless for
 * it — `fidelity: EXACT` below is the check, run against the uncut live corpus
 * every time this script is run.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readTranscriptSessions } from "../src/telemetry/preflight.js";
import {
  formatRungSuggestionCensus,
  RUNG_SUGGESTION_RULE,
  rungSuggestionCensus,
} from "../src/telemetry/rung-suggestion.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-rung-suggestion-corpus.ts <projects-dir> <out-dir>");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

const RUNG_TOOLS = /(?:^|__)(ost_create_node|ost_set_evidence)$/;
const RUNG_REFUSAL = /cannot declare '[a-z]+'/;

interface Parsed {
  raw: string;
  entry: Record<string, unknown> | null;
}

function blocks(entry: Record<string, unknown> | null): Record<string, unknown>[] {
  const message = entry?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

/** Indices to keep for one session, or null when it holds no rung refusal. */
function windowsFor(lines: Parsed[]): Set<number> | null {
  const callAt = new Map<string, number>();
  /** Entries the census reads at all: a rung-declaring call, or its result. */
  const relevant: number[] = [];
  const rungCallIndices: number[] = [];
  const refusals: { call: number; result: number }[] = [];

  lines.forEach((line, i) => {
    for (const block of blocks(line.entry)) {
      if (block.type === "tool_use" && RUNG_TOOLS.test(String(block.name ?? ""))) {
        const id = String(block.id ?? "");
        if (id) callAt.set(id, i);
        rungCallIndices.push(i);
        relevant.push(i);
      }
      if (block.type === "tool_result") {
        const call = callAt.get(String(block.tool_use_id ?? ""));
        if (call === undefined) continue;
        relevant.push(i);
        if (block.is_error === true && RUNG_REFUSAL.test(resultText(block.content))) {
          refusals.push({ call, result: i });
        }
      }
    }
  });
  if (!refusals.length) return null;

  const keep = new Set<number>();
  for (const refusal of refusals) {
    // Forward to the entry holding the Nth rung-declaring call after the refusal,
    // so every candidate retry the window admits is present.
    const later = rungCallIndices.filter((i) => i > refusal.result);
    const end =
      later.length > RUNG_SUGGESTION_RULE.retryWindowCalls
        ? later[RUNG_SUGGESTION_RULE.retryWindowCalls]
        : lines.length - 1;
    for (const i of relevant) {
      if (i >= refusal.call && i <= end) keep.add(i);
    }
  }
  return keep;
}

fs.mkdirSync(out, { recursive: true });
for (const file of fs.readdirSync(out)) {
  if (file.endsWith(".jsonl")) fs.rmSync(path.join(out, file));
}

const cut: TranscriptSession[] = [];
for (const session of readTranscriptSessions(root)) {
  if (!RUNG_REFUSAL.test(session.jsonl)) continue; // cheap reject before the parse
  const lines: Parsed[] = session.jsonl.split("\n").map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return { raw, entry: null };
    try {
      return { raw: trimmed, entry: JSON.parse(trimmed) as Record<string, unknown> };
    } catch {
      return { raw: trimmed, entry: null };
    }
  });
  const keep = windowsFor(lines);
  if (!keep) continue;
  const jsonl = [...keep]
    .sort((a, b) => a - b)
    .map((i) => redactSecrets(lines[i].raw))
    .join("\n");
  cut.push({ id: session.id, jsonl });
  fs.writeFileSync(path.join(out, `${session.id}.jsonl`), `${jsonl}\n`);
}

// Fidelity, printed rather than asserted: the cut is only worth committing if it
// reproduces the census the live corpus gives. A difference here is the cut
// being wrong, and it must be read before the fixture is committed.
const live = rungSuggestionCensus(readTranscriptSessions(root));
const fixture = rungSuggestionCensus(cut);
console.log(`sessions cut: ${cut.length}\n`);
console.log("── live ──");
console.log(formatRungSuggestionCensus(live));
console.log("\n── fixture ──");
console.log(formatRungSuggestionCensus(fixture));
const same =
  live.suggested === fixture.suggested &&
  live.paired === fixture.paired &&
  live.unretried === fixture.unretried &&
  live.reflexive === fixture.reflexive &&
  live.rungRefusalsSeen === fixture.rungRefusalsSeen &&
  JSON.stringify(live.readings) === JSON.stringify(fixture.readings);
console.log(`\nfidelity: ${same ? "EXACT" : "DIFFERS — do not commit until the cut is fixed"}`);
