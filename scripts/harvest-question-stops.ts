/**
 * Re-derive the mechanical half of the question-stop corpus from this machine's
 * Claude Code transcripts.
 *
 * The fixture at `test/fixtures/question-stops/stops.json` holds seventeen
 * AskUserQuestion stops across nine conversations. Its ask fields (session,
 * entry, timestamp, question, options, answer) are mechanical; its
 * outstanding-work lists and labels are authored readings — see that
 * directory's PROVENANCE.md. This script re-runs the mechanical cut so the
 * corpus can be checked against the raw transcripts instead of trusted:
 *
 *   npx tsx scripts/harvest-question-stops.ts ~/.claude/projects/-Users-tanner-dev-OST-Agent
 *
 * The cut, in order:
 *   1. candidate sessions are the ones named below — every transcript the meta
 *      vault held a TRANSCRIPT: evidence record for on 2026-08-03, the day the
 *      assumption test fixed its corpus;
 *   2. fork pairs (identical first-ask timestamp) keep the longer transcript;
 *   3. asks with no tool_result (the session ended first) are dropped —
 *      a stop with no unsealed remainder has no answer key.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";

/** The vault's transcript evidence records as of 2026-08-03, by session id. */
const CANDIDATES = [
  "16e9596b-7c8f-445b-a8ff-f822ed211ea5",
  "7e982096-36c5-4ac2-a23f-75865bc4bf8e",
  "e42cd03d-b2a4-44ba-989a-9e01cc368f77",
  "748498c4-31fb-4110-9012-464c441a463f",
  "470cb94a-d709-43b1-85aa-dedd917ac866",
  "a615eb46-cc50-41a9-a77f-931c0dc67db0",
  "424486ec-3489-4b53-8e2b-012232d221ab",
  "87a025f8-c6b0-474f-9a13-0b5ec5c922ea",
  "0d27cebf-9b5d-4cff-906c-0134512573bc",
  "3d729ebc-348f-4d45-8f3c-25df1de8fbc9",
];

interface Stop {
  session: string;
  entry: number;
  askedAt: string;
  headers: string[];
  questions: string[];
  options: string[];
  answered: boolean;
  answer?: string;
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

function readStops(file: string): { stops: Stop[]; entries: number } {
  const session = path.basename(file, ".jsonl");
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
  const results = new Map<string, string>();
  for (const entry of parsed) {
    const content = (entry?.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_result") {
        results.set(String(block.tool_use_id ?? ""), resultText(block.content));
      }
    }
  }
  const stops: Stop[] = [];
  parsed.forEach((entry, i) => {
    const content = (entry?.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== "tool_use" || block.name !== "AskUserQuestion") continue;
      const input = block.input as {
        questions?: { header?: string; question?: string; options?: { label?: string; description?: string }[] }[];
      };
      const questions = input.questions ?? [];
      const answer = results.get(String(block.id ?? ""));
      stops.push({
        session,
        entry: i,
        askedAt: typeof entry?.timestamp === "string" ? entry.timestamp : "",
        headers: questions.map((q) => q.header ?? ""),
        questions: questions.map((q) => redactSecrets(q.question ?? "")),
        options: questions.flatMap((q) =>
          (q.options ?? []).map((o) => redactSecrets(`${o.label ?? ""} — ${o.description ?? ""}`)),
        ),
        answered: answer !== undefined,
        answer: answer === undefined ? undefined : redactSecrets(answer).slice(0, 600),
      });
    }
  });
  return { stops, entries: parsed.length };
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/harvest-question-stops.ts <transcript-dir>");
  process.exit(1);
}

const bySession = new Map<string, { stops: Stop[]; entries: number }>();
for (const id of CANDIDATES) {
  const file = path.join(dir, `${id}.jsonl`);
  if (!fs.existsSync(file)) {
    console.error(`missing transcript: ${file}`);
    continue;
  }
  bySession.set(id, readStops(file));
}

// Fork dedup: same first-ask timestamp means same conversation; keep the longer.
const byFirstAsk = new Map<string, string>();
for (const [id, { stops }] of bySession) {
  const first = stops[0]?.askedAt ?? `no-asks:${id}`;
  const held = byFirstAsk.get(first);
  if (held === undefined) {
    byFirstAsk.set(first, id);
    continue;
  }
  const keep = (bySession.get(held)?.entries ?? 0) >= (bySession.get(id)?.entries ?? 0) ? held : id;
  byFirstAsk.set(first, keep);
}
const kept = new Set(byFirstAsk.values());

const out = [...kept]
  .flatMap((id) => bySession.get(id)?.stops ?? [])
  .filter((s) => s.answered)
  .sort((a, b) => a.askedAt.localeCompare(b.askedAt));

console.error(
  `${out.length} answered stop(s) across ${new Set(out.map((s) => s.session)).size} conversation(s) ` +
    `(dropped: ${CANDIDATES.length - kept.size} fork twin(s), ` +
    `${[...kept].flatMap((id) => bySession.get(id)?.stops ?? []).filter((s) => !s.answered).length} unanswered ask(s))`,
);
console.log(JSON.stringify(out, null, 2));
