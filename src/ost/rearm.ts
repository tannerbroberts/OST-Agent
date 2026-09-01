/**
 * Re-arming a build permit when a displaced instrument is put back.
 *
 * ## What was already true, and why it is the whole problem
 *
 * An observation is recognised by the command it names: every line in a node's
 * `## Instrument Log` carries the command in backticks, and
 * {@link ./instrument.ts}'s `currentObservations` keeps only the lines matching
 * the command the node declares TODAY. That filter is what stops an instrument
 * swap from inheriting a permit — point the test at a different command and its
 * old reds stop counting.
 *
 * The consequence nobody wrote down is that the filter is **symmetric**. Set the
 * original command back, byte for byte, and its old reds start counting again,
 * because the log is append-only and the string matches. Re-arming was never a
 * feature that had to be built; it has been the behaviour since the filter was
 * written, and it happened silently, unconditionally, and with no record that it
 * had happened. That was measured against this repository on 2026-09-01 rather
 * than assumed: swap `test/a.test.ts` → `test/b.test.ts` → `test/a.test.ts` and
 * the permit clears, is withdrawn, and clears again with no other change.
 *
 * So the work here is not to *give* a restore its permit back. It is to take one
 * away when the restore cannot honestly claim it — which is the hole the solution
 * node named as its own worst failure mode: "byte-identity of the command does
 * not establish identity of what it measured".
 *
 * ## The identity condition
 *
 * A red says *this spec file failed against this repository*. The command names
 * the spec file; it says nothing about the file's contents. If the file changed
 * while a different command was attached, the recorded red describes a spec that
 * no longer exists, and handing its permit back is exactly the un-clearing rule
 * being defeated by a string comparison.
 *
 * So each observation records a digest of the spec file it measured, and a
 * restore records the digest of the spec file as it stands at the moment of the
 * restore. Equal digests mean the observation still describes what is on disk and
 * the permit re-arms. Anything else — a different digest, an unreadable file, an
 * observation recorded before digests existed — WITHHOLDS the observation, and
 * the permit stays un-cleared until somebody runs `ost-agent verify` again. Note
 * the direction: the failure cases all fail closed, because "we cannot prove the
 * file is the same" and "the file is different" license exactly the same amount
 * of building, which is none.
 *
 * ## Why the withholding is a count
 *
 * The log is append-only and nothing may rewrite a recorded line, so a withheld
 * observation cannot be marked in place. What the restore writes instead is a
 * clause in `## History` saying how many of that command's observations existed
 * when it was withheld, and the reader drops that many from the front of the
 * command's observation list. Later observations — a fresh `verify` after the
 * restore — sit past the count and are unaffected, which is what makes the permit
 * re-earnable by measuring rather than by another swap.
 *
 * Two directions are deliberately conservative. Repeated cycles take the LARGEST
 * recorded withholding rather than the sum, because each count already covers
 * every line before it. And a later restore that succeeds does not release
 * observations an earlier one withheld: they were measured against a file that
 * has since been two different things, and the tree has no record that the second
 * of those is the one they saw.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HISTORY_HEADING } from "./headings.js";
import type { OstNode } from "./node.js";

/**
 * Hex characters kept from the sha256 of a spec file.
 *
 * Twelve, because this is an identity check between two files on one machine
 * rather than a defence against a chosen-prefix attack: the digests being
 * compared are both written by this tool from files in a repository the operator
 * already granted, and a collision would have to be authored by whoever is
 * already allowed to edit the spec.
 */
const SPEC_DIGEST_LENGTH = 12;

/** The recorded form of a spec digest, as it appears in a log or history line. */
export function formatSpecDigest(digest: string): string {
  return `[spec ${digest}]`;
}

/** The digest recorded in a line, or undefined for a line written without one. */
export function specDigestIn(line: string): string | undefined {
  return /\[spec ([0-9a-f]+)\]/.exec(line)?.[1];
}

/**
 * The digest of a spec file as it stands in the first repo that has it.
 *
 * Resolution matches {@link ./instrument.ts#specResolves} exactly — first repo
 * that holds the path wins — so the file this hashes is the file the command
 * would run. Undefined when no configured repo has it, or when it cannot be
 * read: both mean "no identity to compare", and every caller here treats that as
 * a reason to withhold rather than to allow.
 */
export function digestSpecFile(repos: readonly string[], target: string): string | undefined {
  for (const repo of repos) {
    const file = path.resolve(repo, target);
    try {
      if (!fs.existsSync(file)) continue;
      return createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, SPEC_DIGEST_LENGTH);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Lines under `## History`, in the order they were written. */
function historyLines(node: OstNode): string[] {
  const lines = (node.body ?? "").split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(HISTORY_HEADING.toLowerCase()));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    if (line.trim().startsWith("- ")) out.push(line.trim());
  }
  return out;
}

/**
 * The command each `instrument:` history line moved FROM and TO.
 *
 * The line is built by {@link ./vault.ts#setInstrument} as
 * `instrument: <prev> → <next>` with any `[sight: …]`, note or re-arm clause
 * after it, and an instrument command cannot contain `[`, `—` or `→`
 * ({@link ../knowledge/instruments.ts} refuses every one of those characters),
 * so splitting on them recovers both ends exactly.
 */
function instrumentTransition(line: string): { from: string; to: string } | undefined {
  const match = /\binstrument:\s+(.+?)\s+→\s+(.+)$/.exec(line);
  if (!match) return undefined;
  const to = match[2].split(" [")[0].split(" — ")[0].trim();
  return { from: match[1].trim(), to };
}

/**
 * Every command this test has carried and given up, newest first.
 *
 * This is the "preserves the old command" half of the guarantee, and it is
 * satisfied by `## History` rather than by a new field: the swap already writes
 * the displaced command down, and a second copy of it somewhere else would be a
 * second thing to keep in step. What was missing was a reader.
 */
export function displacedCommands(node: OstNode): string[] {
  const out: string[] = [];
  for (const line of historyLines(node)) {
    const move = instrumentTransition(line);
    if (!move || move.from === "(none)" || move.from === move.to) continue;
    out.unshift(move.from);
  }
  return out;
}

/** How many of `command`'s observations a past restore refused to re-arm. */
export function withheldObservations(node: OstNode, command: string): number {
  let withheld = 0;
  for (const line of historyLines(node)) {
    if (instrumentTransition(line)?.to !== command) continue;
    const count = /\[re-arm: (\d+) observation\(s\) withheld/.exec(line)?.[1];
    // The largest, not the sum: a count covers every observation recorded before
    // it, so two cycles that each withhold "everything so far" are one fact
    // stated twice.
    if (count) withheld = Math.max(withheld, Number(count));
  }
  return withheld;
}

/** What a write setting `command` on this node does to the observations it already has. */
export interface RearmRuling {
  /** Does this write put back a command that already carries observations? */
  restoring: boolean;
  /** Observations this write refuses to re-arm. Zero when they all stand. */
  withheld: number;
  /** Appended to the History line so the refusal is readable and countable later. */
  clause: string;
  /** Said back to the caller, so a re-arm is never something that just happens. */
  reason: string;
}

const INERT: RearmRuling = { restoring: false, withheld: 0, clause: "", reason: "" };

/**
 * May the observations already logged against `command` count again?
 *
 * `digestNow` is the spec file as it stands at the moment of the write —
 * undefined when no configured repo holds it, which is a withholding rather than
 * a pass, for the reason in this file's header.
 */
export function rearmRuling(node: OstNode, command: string, digestNow: string | undefined): RearmRuling {
  const already = withheldObservations(node, command);
  const observations = (node.body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") && l.includes(`\`${command}\``) && /\*\*(red|green|no-spec|unavailable)\*\*/i.test(l))
    .slice(already);
  if (observations.length === 0) return INERT;

  const total = already + observations.length;
  const measured = specDigestIn(observations[observations.length - 1]);
  if (digestNow && measured && digestNow === measured) {
    return {
      restoring: true,
      withheld: 0,
      clause: ` [re-arm: ${observations.length} observation(s) restored, ${formatSpecDigest(digestNow)}]`,
      reason:
        `${observations.length} prior observation(s) of this command are re-armed: the spec file is byte-identical ` +
        `to the one they were measured against (spec ${digestNow}).`,
    };
  }

  const why = !measured
    ? "they were recorded before the spec file's contents were digested, so nothing here can show what they measured"
    : !digestNow
      ? "the spec file cannot be read in any configured repository, so nothing here can show what they measured"
      : `the spec file changed while another command was attached (spec ${measured} → ${digestNow})`;
  return {
    restoring: true,
    withheld: total,
    clause: ` [re-arm: ${total} observation(s) withheld — ${why}]`,
    reason:
      `${observations.length} prior observation(s) of this command are NOT re-armed — ${why}. The command string ` +
      `matching is not evidence that the code it measured does. Run \`ost-agent verify\` to earn the permit again.`,
  };
}
