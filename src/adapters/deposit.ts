/**
 * The end-of-session deposit — the channel a collaborator's reasoning enters
 * through, at the moment it is still in their head.
 *
 * The committed record shows what a builder did; what they considered and
 * rejected, what they could not do and why, what they would have done with more
 * room is invisible in every artifact and obvious to the person who chose it.
 * This channel announces itself when a session, a PR or a review closes: one
 * question, asked in the surface the collaborator is already using, and the
 * answer stored VERBATIM.
 *
 * Three containments carry this module's honesty, and the spec
 * (`test/adapters/deposit-prompt.test.ts`) pins each one:
 *
 * 1. **Verbatim.** The answer is written byte-for-byte below a fixed marker
 *    line. No cleaning, no flattening, no redaction, no truncation — a deposit
 *    is a human's deliberate words, not the agent's live context, and a storage
 *    path that edits them is a storage path that can shade them. (The framing
 *    around the answer is agent-authored metadata and IS cleaned; the answer is
 *    not.)
 * 2. **Nothing inferred.** The file is a fixed template plus the answer. No
 *    summary, no classification, no extracted capability — the record is what
 *    was said, and every conclusion is left to a reader with the whole file.
 * 3. **Assertion floor, not promotable from here.** A deposit is narrated
 *    self-report, so it enters the evidence pipeline like any drop-folder note:
 *    ingested by `ost_ingest_inbox`, stamped `actor: "inbox"` by the surface,
 *    which the trust ledger keys as `channel:inbox` — initial rung `assertion`.
 *    This module holds no reference to the trust ledger and appends nothing to
 *    it; the only way a deposit's standing rises is a human recording a test
 *    result on the CLI. A channel that could promote its own output would break
 *    the ladder rather than feed it.
 */
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "../config/load.js";
import { DEPOSIT_CHANNEL, resolveChannels } from "./channels.js";
import { redactSecrets } from "./transcript.js";

/**
 * The one question, asked at the close. Exported so every surface that offers
 * the prompt asks the same thing — a channel whose question drifts per surface
 * is several channels wearing one name.
 */
export const DEPOSIT_PROMPT =
  "Before this closes: what was the reasoning behind what you just did — " +
  "what did you consider and reject, what could you not do and why, and " +
  "what would you have done with more room?";

/**
 * The line that separates the agent-authored frame from the collaborator's
 * words. Everything after it (plus one newline) is the answer, byte-for-byte —
 * which is what makes "stored verbatim" a checkable property of the file
 * rather than a promise in a doc comment.
 */
export const VERBATIM_MARKER =
  "Deposited verbatim below this line. Nothing after it was written, altered or inferred by the agent.";

export interface DepositFiling {
  /** The collaborator's answer, exactly as they gave it. Stored byte-for-byte. */
  answer: string;
  /** Who deposited, in their own terms (a name, a handle). Optional. */
  from?: string;
  /** What just closed — "session", "pr", "review". Optional, free-form. */
  closing?: string;
  /** ISO timestamp; defaults to now. Injected so tests are deterministic. */
  at?: string;
}

const MAX_META_CHARS = 120;

/** Metadata is agent-authored framing, so it gets friction's cleaning. The answer never does. */
function cleanMeta(text: string): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > MAX_META_CHARS ? `${flat.slice(0, MAX_META_CHARS)}…` : flat;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "deposit"
  );
}

/** Pick a filename that does not exist yet — an earlier deposit is never replaced. */
function uniquePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}.md`);
  }
  return candidate;
}

/**
 * Where a deposit goes: the `deposit` channel's folder, resolved not guessed —
 * `frictionDir`'s argument verbatim. `readConfig` with `missing: "defaults"`
 * because the folder is a code constant and a broken config must not cost a
 * collaborator the answer they just typed; `enabled` is not consulted because
 * that switch governs reading, and an unread deposit still sits in git where a
 * person can find it.
 */
function depositDir(vaultDir: string): string {
  const { config } = readConfig(vaultDir, { missing: "defaults" });
  const channel = resolveChannels(vaultDir, config).channels.find((c) => c.name === DEPOSIT_CHANNEL);
  if (!channel) throw new Error(`no "${DEPOSIT_CHANNEL}" channel resolved for this vault — it is declared in src/adapters/channels.ts`);
  return channel.dir;
}

/**
 * Store one deposit in the vault's deposit channel. Returns the path written.
 * Throws on an empty answer — a deposit that says nothing still counts as a
 * deposit to the assumption test that counts who comes back, and inflating
 * that number is worse than refusing.
 */
export function fileDeposit(vaultDir: string, filing: DepositFiling): string {
  const answer = filing.answer ?? "";
  if (!answer.trim()) {
    throw new Error("a deposit needs the collaborator's answer — if they declined, store nothing");
  }

  const dir = path.resolve(vaultDir);
  const inboxDir = depositDir(dir);
  fs.mkdirSync(inboxDir, { recursive: true });

  const at = filing.at ?? new Date().toISOString();
  const day = at.slice(0, 10);
  const from = filing.from ? cleanMeta(filing.from) : "";
  const closing = filing.closing ? cleanMeta(filing.closing) : "";

  const body = [
    `# Deposit${closing ? ` (${closing})` : ""}: ${day}`,
    "",
    `- **prompt:** ${DEPOSIT_PROMPT}`,
    `- **deposited:** ${at}`,
    ...(from ? [`- **by:** ${from}`] : []),
    "",
    "Evidence class: **assertion** — narrated self-report by the person who did the work. It grounds",
    "what they say about their own reach, which is not a measurement of it, and nothing on the deposit",
    "path can raise it: standing is earned only by a test a human records.",
    "",
    VERBATIM_MARKER,
    "",
    answer,
  ].join("\n");

  const target = uniquePath(inboxDir, `${day}-deposit${from ? `-${slug(from)}` : ""}`);
  fs.writeFileSync(target, body, "utf8");
  return target;
}

/**
 * The collaborator's answer, read back off a stored deposit file — the exact
 * bytes `fileDeposit` was given. The inverse exists so "verbatim" is testable
 * as a round trip rather than by re-deriving the template in the spec.
 */
export function depositAnswer(fileBody: string): string | null {
  const idx = fileBody.indexOf(`${VERBATIM_MARKER}\n\n`);
  if (idx === -1) return null;
  return fileBody.slice(idx + VERBATIM_MARKER.length + 2);
}
