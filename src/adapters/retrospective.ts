/**
 * The end-of-session retrospective — the confession the agent writes about its
 * own confusion, not a summary of what it did.
 *
 * `friction.ts` fires AT the moment of pain, which is exactly when a conceptual
 * mistake is invisible: an agent halfway down a wrong framing does not know it
 * is on one, so the thing it would file in the moment is "this is going fine."
 * Conceptual friction is only legible AFTER the reversal — the moment you
 * discover the approach was wrong is the moment you can name it. This module is
 * that after-the-fact channel: one short account of the wrong turn a session
 * took, filed at the close rather than mid-work.
 *
 * **The design question this module has to survive, stated by the node itself:
 * whether it can stay silent credibly.** The channel's existing problem is not
 * volume — 82 mechanical friction events already arrive and none of them is
 * useful — so a retrospective that mostly says "nothing notable" makes that
 * worse, not better. `fileRetrospective` enforces the silent half directly: it
 * throws on an empty `wrongTurn` rather than accepting one, so there is no call
 * shape that produces a "nothing to report" file. A session with nothing
 * conceptual to confess is a session that never calls this function, and
 * therefore never produces an inbox item — the absence of a file IS the record
 * for that session, exactly as a mostly-silent channel needs it to be.
 *
 * Lands in the **`retrospective` channel** (see `channels.ts`), a first-party
 * channel of its own — not `friction`, because the two speak about different
 * moments, and not `deposit`, because the speaker differs: a deposit is a
 * human's verbatim answer, this is the agent's own account of its own
 * confusion, and folding the two into one file would leave a mapping pass
 * unable to tell whose words it is reading.
 */
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "../config/load.js";
import { RETROSPECTIVE_CHANNEL, resolveChannels } from "./channels.js";
import { redactSecrets } from "./transcript.js";

export interface RetrospectiveFiling {
  /**
   * The confession: the wrong turn this session took — a wrong framing, a rule
   * misread, a dead-end approach. Required. There is no field for "nothing
   * notable"; a session with nothing conceptual to confess must not call
   * `fileRetrospective` at all.
   */
  wrongTurn: string;
  /** Optional: roughly what the wrong turn cost — time, a redone step, a discarded approach. */
  cost?: string;
  /** Optional: what the agent would have needed to know at the start to avoid it. */
  wouldHaveNeeded?: string;
  /** The session id this retrospective is about — the provenance a reader checks it against. */
  session: string;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

const MAX_FIELD_CHARS = 1000;

function clean(text: string, max: number): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "retrospective"
  );
}

/** Pick a filename that does not exist yet — an earlier retrospective is never replaced. */
function uniquePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}.md`);
  }
  return candidate;
}

/**
 * Where a retrospective goes: the `retrospective` channel's folder, resolved not
 * guessed — `frictionDir`'s and `depositDir`'s argument verbatim. `readConfig`
 * with `missing: "defaults"` because the folder is a code constant and a broken
 * config must not cost the session the one account of its own confusion it
 * chose to write; `enabled` is not consulted because that switch governs
 * reading, and an unread retrospective still sits in git where a person can
 * find it.
 */
function retrospectiveDir(vaultDir: string): string {
  const { config } = readConfig(vaultDir, { missing: "defaults" });
  const channel = resolveChannels(vaultDir, config).channels.find((c) => c.name === RETROSPECTIVE_CHANNEL);
  if (!channel) {
    throw new Error(`no "${RETROSPECTIVE_CHANNEL}" channel resolved for this vault — it is declared in src/adapters/channels.ts`);
  }
  return channel.dir;
}

/**
 * File one end-of-session retrospective into the vault's retrospective channel.
 * Returns the path written.
 *
 * Throws on an empty `wrongTurn` or an empty `session` — a retrospective that
 * confesses nothing is not a quieter retrospective, it is the "nothing notable"
 * filing the design constraint refuses, and one with no session id is a
 * confession nobody can trace back to check. The caller's job when a session
 * genuinely had no conceptual wrong turn is to not call this function at all.
 */
export function fileRetrospective(vaultDir: string, filing: RetrospectiveFiling): string {
  const wrongTurn = clean(filing.wrongTurn ?? "", MAX_FIELD_CHARS);
  if (!wrongTurn) {
    throw new Error(
      "a retrospective needs a wrong turn to confess — if this session had nothing conceptual to report, " +
        "do not file one at all",
    );
  }
  const session = clean(filing.session ?? "", 200);
  if (!session) {
    throw new Error("a retrospective needs a session id — it is the provenance a reader checks the confession against");
  }

  const dir = path.resolve(vaultDir);
  const retroDir = retrospectiveDir(dir);
  fs.mkdirSync(retroDir, { recursive: true });

  const at = filing.at ?? new Date().toISOString();
  const day = at.slice(0, 10);
  const cost = filing.cost ? clean(filing.cost, MAX_FIELD_CHARS) : "";
  const wouldHaveNeeded = filing.wouldHaveNeeded ? clean(filing.wouldHaveNeeded, MAX_FIELD_CHARS) : "";

  const body = [
    `# Retrospective: ${wrongTurn}`,
    "",
    `- **session:** ${session}`,
    `- **written:** ${at}`,
    "",
    `**Wrong turn:** ${wrongTurn}`,
    "",
    ...(cost ? [`**Cost:** ${cost}`, ""] : []),
    ...(wouldHaveNeeded ? [`**Would have needed:** ${wouldHaveNeeded}`, ""] : []),
    "Filed by the agent at the close of a session it wanted to declare successful. Evidence class: **assertion** —",
    "self-report by the party whose confusion is being described, thinnest exactly where the session went worst.",
    "This is the only channel with access to why the agent believed what it believed; nothing on this path can",
    "raise its rung — standing is earned only by a human comparing it against the session's own record.",
    "",
  ].join("\n");

  const target = uniquePath(retroDir, `${day}-retrospective-${slug(wrongTurn)}`);
  fs.writeFileSync(target, body, "utf8");
  return target;
}
