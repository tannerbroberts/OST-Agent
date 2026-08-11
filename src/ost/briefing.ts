/**
 * The standing Next Build briefing — one file, one address, rewritten every pass.
 *
 * The content this file holds already existed before the file did: each pass's
 * closing read of what to build next and why. It was going into annotations on
 * the root Outcome, where the one thing a builder most needs sat at the bottom
 * of an undifferentiated queue of things a human needs to decide. Giving it a
 * fixed address is the whole feature: nothing else in the tree changes, and a
 * builder no longer re-derives the candidate order before any work starts.
 *
 * Two claims are load-bearing, and both are the object under test in
 * `test/ost/next-build-briefing.test.ts`:
 *
 *   1. **One stable address.** {@link nextBuildPath} is a pure function of the
 *      vault directory — `<vault>/.ost-agent/NEXT-BUILD.md` — so every pass,
 *      every session and every reader resolve the same file without agreeing on
 *      anything beyond which vault they are in. `.ost-agent/` because the
 *      briefing is agent working state, not a tree node: Obsidian ignores the
 *      dot-folder, and `ost-agent init` already scaffolds it.
 *   2. **A rewrite preserves what it supersedes.** The briefing is a reading,
 *      not a decision, and the history of readings is the record of how the
 *      agent's judgement moved. So {@link rewriteBriefing} never overwrites: the
 *      outgoing current reading becomes the newest History entry, every older
 *      entry is carried verbatim, and the file only ever grows. A briefing that
 *      says the same thing five passes running is the failure mode the node
 *      itself predicted — history is what lets a reader see the repetition.
 *
 * What this deliberately does NOT solve: uptake. The observed failure of the
 * briefing (2026-07-26) was not noise but collision — two passes read the same
 * briefing hours apart and both built what it named, because a statement of
 * intent carries no record of who is acting on it. That is
 * {@link ../loop/claim.ts}'s job, and the two are designed as a pair: this
 * module is the shared vocabulary `claim` resolves work namings against.
 */
import fs from "node:fs";
import path from "node:path";

/** The one filename, exported so no caller spells it independently. */
export const NEXT_BUILD_FILENAME = "NEXT-BUILD.md";

/**
 * The briefing's stable address for a vault: `<vault>/.ost-agent/NEXT-BUILD.md`.
 *
 * `path.resolve` so two spellings of the same vault (relative and absolute)
 * answer identically — the address must not depend on where the caller stood.
 */
export function nextBuildPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", NEXT_BUILD_FILENAME);
}

/** One reading: what a pass concluded, dated by the pass that wrote it. */
export interface BriefingReading {
  /** As written by the pass, e.g. `2026-08-11` — never invented on read. */
  date: string;
  /** The reading's prose, verbatim. */
  body: string;
}

export interface Briefing {
  /** The reading a builder should act on, or null when no briefing exists yet. */
  current: BriefingReading | null;
  /** Superseded readings, newest first, each verbatim as originally written. */
  history: BriefingReading[];
}

const HEADER = [
  "# NEXT BUILD",
  "",
  "**Stable address. Rewritten at the end of every pass; superseded readings are",
  "kept below under History, so this file only ever grows.** A reading of what",
  "the tree implies, not a decision — promotion, killing, and validation stay",
  "human. Before acting on the current reading, check `ost-agent claim --list`:",
  "a briefing names work, it does not say the work has been taken.",
].join("\n");

const CURRENT_HEADING = /^## Current — (.+)$/;
const HISTORY_HEADING = /^## History$/;
const ENTRY_HEADING = /^### (.+)$/;

/**
 * Values that destroy rather than inform, refused before anything is read or
 * written. The same tripwire `Vault.annotate` holds (21 annotation lines across
 * 16 nodes were each the four characters `undefined`): the rule is the content
 * is *exactly* that, never *contains* it, so a reading discussing the word
 * "undefined" is still writable.
 */
function assertWritable(name: string, value: string): void {
  const t = value.trim();
  if (t.length === 0 || /^(undefined|null)$/i.test(t)) {
    throw new Error(`refusing to write the briefing: ${name} is ${t.length === 0 ? "empty" : `the literal string "${t}"`}`);
  }
}

/**
 * Read the briefing at its stable address.
 *
 * A file this module wrote parses into current + history. A file it did not
 * write — the format predates this module in at least one live vault — comes
 * back as `current` with the whole content as the body and a date recovered
 * from a `_Last rewritten: <date>…_` line when one exists, `"undated"` when
 * not. Nothing is a parse error: whatever is at the address is the briefing.
 */
export function readBriefing(vaultDir: string): Briefing {
  const p = nextBuildPath(vaultDir);
  if (!fs.existsSync(p)) return { current: null, history: [] };
  return parseBriefing(fs.readFileSync(p, "utf8"));
}

function parseBriefing(content: string): Briefing {
  const lines = content.split("\n");
  const currentAt = lines.findIndex((l) => CURRENT_HEADING.test(l));
  if (currentAt === -1) return { current: freeFormReading(content), history: [] };

  const historyAt = lines.findIndex((l, i) => i > currentAt && HISTORY_HEADING.test(l));
  const currentEnd = historyAt === -1 ? lines.length : historyAt;
  const current: BriefingReading = {
    date: (CURRENT_HEADING.exec(lines[currentAt]) as RegExpExecArray)[1],
    body: lines.slice(currentAt + 1, currentEnd).join("\n").trim(),
  };

  const history: BriefingReading[] = [];
  if (historyAt !== -1) {
    let entry: { date: string; start: number } | null = null;
    const close = (end: number) => {
      if (entry) history.push({ date: entry.date, body: lines.slice(entry.start, end).join("\n").trim() });
    };
    for (let i = historyAt + 1; i < lines.length; i++) {
      const m = ENTRY_HEADING.exec(lines[i]);
      if (m) {
        close(i);
        entry = { date: m[1], start: i + 1 };
      }
    }
    close(lines.length);
  }
  return { current, history };
}

/** A briefing written before this module existed: keep all of it, lose nothing. */
function freeFormReading(content: string): BriefingReading {
  const dated = /_Last rewritten: ([^\s_.]+)/.exec(content);
  return { date: dated ? dated[1] : "undated", body: content.trim() };
}

/**
 * Rewrite the briefing: the new reading becomes current, the outgoing current
 * becomes the newest History entry, and every prior entry is carried verbatim.
 *
 * Returns the stable address it wrote. Creates `.ost-agent/` if the vault has
 * never had one — a first briefing must not require a scaffolding step nobody
 * remembers to run.
 */
export function rewriteBriefing(vaultDir: string, reading: BriefingReading): string {
  assertWritable("the reading", reading.body);
  assertWritable("the date", reading.date);

  const prior = readBriefing(vaultDir);
  const history = prior.current ? [prior.current, ...prior.history] : prior.history;

  const parts = [HEADER, "", `## Current — ${reading.date}`, "", reading.body.trim()];
  if (history.length > 0) {
    parts.push("", "## History");
    for (const h of history) parts.push("", `### ${h.date}`, "", h.body);
  }

  const p = nextBuildPath(vaultDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, parts.join("\n") + "\n");
  return p;
}

/** Render a briefing for the terminal — the reader surface `next-build` prints. */
export function renderBriefing(briefing: Briefing, address: string, withHistory: boolean): string {
  if (briefing.current === null) {
    return `No standing briefing yet — one would live at ${address}. Write the first with \`ost-agent next-build --rewrite <file>\`.`;
  }
  const out = [`NEXT BUILD (${briefing.current.date}) — ${address}`, "", briefing.current.body];
  if (withHistory) {
    out.push("", `${briefing.history.length} prior reading(s):`);
    for (const h of briefing.history) out.push("", `--- ${h.date} ---`, h.body);
  } else if (briefing.history.length > 0) {
    out.push("", `(${briefing.history.length} prior reading(s) preserved — \`--history\` to see them.)`);
  }
  return out.join("\n");
}
