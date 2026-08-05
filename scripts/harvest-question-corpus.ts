/**
 * Cut the clarifying-question corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/question-budget/sessions.json`.
 * It exists so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md` for what the rule is
 * and what it deliberately leaves out.
 *
 *   npx tsx scripts/harvest-question-corpus.ts ~/.claude/projects > out.json
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { MIN_QUESTIONS_PER_SESSION, type HarvestedQuestion, type HarvestedSession } from "../src/loop/questions.js";

/** How much of an answer is kept. Enough to read the operator's own words, bounded. */
const MAX_ANSWER_CHARS = 600;

interface RawAsk {
  entry: number;
  ts: string;
  id: string;
  questions: { header?: string; question?: string; options?: { label?: string }[] }[];
}

function parseEntries(file: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // a corrupt line costs one entry, never the session
    }
  }
  return entries;
}

function blocksOf(entry: Record<string, unknown>): Record<string, unknown>[] {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

/** The tool_result text for a tool_use id, flattened and clipped. */
function resultsById(entries: Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    for (const block of blocksOf(entry)) {
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const content = block.content;
      const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
      out.set(block.tool_use_id, redactSecrets(text).replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS));
    }
  }
  return out;
}

function asksIn(entries: Record<string, unknown>[]): RawAsk[] {
  const asks: RawAsk[] = [];
  entries.forEach((entry, index) => {
    for (const block of blocksOf(entry)) {
      if (block.type !== "tool_use" || !String(block.name ?? "").endsWith("AskUserQuestion")) continue;
      const input = block.input as { questions?: RawAsk["questions"] } | undefined;
      asks.push({
        entry: index,
        ts: typeof entry.timestamp === "string" ? entry.timestamp : "",
        id: String(block.id ?? ""),
        questions: input?.questions ?? [],
      });
    }
  });
  return asks;
}

function harvest(root: string): HarvestedSession[] {
  const candidates: (HarvestedSession & { firstAskTs: string })[] = [];

  for (const project of fs.readdirSync(root).sort()) {
    const dir = path.join(root, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
      const entries = parseEntries(path.join(dir, name));
      const asks = asksIn(entries);
      if (asks.length === 0) continue;
      const results = resultsById(entries);

      const questions: HarvestedQuestion[] = [];
      for (const ask of asks) {
        // An ask carrying several questions was ONE interruption; the questions
        // inside it still arrived in order and are replayed in it.
        const answer = results.get(ask.id);
        for (const q of ask.questions) {
          questions.push({
            entry: ask.entry,
            askId: ask.id,
            header: String(q.header ?? ""),
            question: redactSecrets(String(q.question ?? "")).replace(/\s+/g, " ").trim(),
            options: (q.options ?? []).map((o) => String(o.label ?? "")),
            ...(answer === undefined ? {} : { answer }),
          });
        }
      }
      // A question with no recorded answer cannot be scored in hindsight, so it is
      // not part of the replay. It is counted in `askedButUnanswered` instead —
      // dropping it silently would shrink a session's denominator unremarked.
      const answered = questions.filter((q) => q.answer !== undefined);
      if (answered.length < MIN_QUESTIONS_PER_SESSION) continue;

      candidates.push({
        id: name.replace(/\.jsonl$/, ""),
        project,
        entries: entries.length,
        interruptions: asks.length,
        askedButUnanswered: questions.length - answered.length,
        questions: answered,
        firstAskTs: asks[0]?.ts ?? "",
      });
    }
  }

  // Claude Code writes a forked/resumed conversation as a second transcript that
  // replays the same asks with the same timestamps. Two of those in this corpus
  // would be one conversation counted twice. Same first-ask timestamp ⇒ same
  // conversation; keep the longer one, then the lexicographically first id, so the
  // choice is a rule rather than a preference.
  const byConversation = new Map<string, (HarvestedSession & { firstAskTs: string })[]>();
  for (const c of candidates) {
    const key = c.firstAskTs || c.id;
    byConversation.set(key, [...(byConversation.get(key) ?? []), c]);
  }
  const kept = [...byConversation.values()].map((group) =>
    group.sort((a, b) => b.questions.length - a.questions.length || a.id.localeCompare(b.id))[0]!,
  );

  return kept
    .sort((a, b) => a.firstAskTs.localeCompare(b.firstAskTs) || a.id.localeCompare(b.id))
    .map(({ firstAskTs: _ts, ...session }) => session);
}

const root = process.argv[2];
if (!root) {
  console.error("usage: npx tsx scripts/harvest-question-corpus.ts <~/.claude/projects>");
  process.exit(2);
}
console.log(JSON.stringify({ sessions: harvest(root) }, null, 2));
