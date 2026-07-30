/**
 * Friction filing — the affordance the agent uses at the point of pain.
 *
 * The transcript harvester reads friction *after the fact*, and only friction
 * that left a machine-readable trace: a failed call, a retry, an interruption.
 * The friction that costs the most — a rule the agent could not interpret, a
 * path it had to guess, an affordance it wished for — leaves no trace at all.
 * This lets the agent file one line the moment it is blocked, uncertain, or
 * forced to guess, while the context is still live.
 *
 * A filing is an ordinary inbox note: append-only, never overwriting an earlier
 * filing, picked up by `ost_ingest_inbox` like any other evidence. Notes are
 * redacted before they land, because whatever the agent was stuck on may be
 * in its hands at the time.
 *
 * Filings land in the **`friction` channel**, not in channel zero. That channel
 * exists for them and its folder is a constant inside the vault, which is what
 * `FRICTION_CHANNEL`'s own doc comment is about: once `init` began writing an
 * escaping `adapters.inbox.path`, a filing written to channel zero landed outside
 * the git working tree, so the vault's own `git add -A` stopped committing the
 * agent's record of where it got stuck.
 */
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "../config/load.js";
import { FRICTION_CHANNEL, resolveChannels } from "./channels.js";
import { redactSecrets } from "./transcript.js";

/** The vocabulary the agent is told to use. Small on purpose — filing must be cheap. */
export const FRICTION_KINDS = ["blocked", "guessed", "unclear-rule", "missing-affordance", "slow"] as const;

export type FrictionFilingKind = (typeof FRICTION_KINDS)[number];

export interface FrictionFiling {
  kind: FrictionFilingKind;
  /** One line: what went wrong, in the agent's own words. */
  note: string;
  /** Optional: what it was doing, or what it wished existed. */
  context?: string;
  /** Optional: which loop/process/session filed this. */
  source?: string;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

const MAX_NOTE_CHARS = 500;
const MAX_CONTEXT_CHARS = 1000;

function clean(text: string, max: number): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function slug(note: string): string {
  return (
    note
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "friction"
  );
}

/** Pick a filename that does not exist yet — an earlier filing is never replaced. */
function uniquePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}.md`);
  }
  return candidate;
}

/**
 * Where a filing goes: the `friction` channel's folder, resolved not guessed.
 *
 * Through {@link resolveChannels} rather than by joining {@link FRICTION_CHANNEL_PATH}
 * here, because that resolver is the single place channel configuration lives and a
 * second computation of "where does friction go" is a second chance to disagree with
 * the folder `init` creates and `ost_ingest_inbox` reads.
 *
 * `readConfig` with `missing: "defaults"`, not `loadConfig`, and that is load-bearing
 * rather than defensive: a config that will not parse is one of the things most worth
 * filing friction ABOUT, and the folder does not depend on the config to be located —
 * the friction channel's path is a code constant, so defaults and a real config
 * resolve it identically. Failing to file because of the thing you are filing about
 * is the worst available behaviour.
 *
 * `enabled` is deliberately not consulted. That switch governs whether the channel is
 * READ; refusing to write would throw the agent's record away to honour a setting
 * about ingestion, and an unread filing still sits in git where a person can find it.
 */
function frictionDir(vaultDir: string): string {
  const { config } = readConfig(vaultDir, { missing: "defaults" });
  const channel = resolveChannels(vaultDir, config).channels.find((c) => c.name === FRICTION_CHANNEL);
  // No fallback path, on `init`'s precedent: `resolveChannels` always returns the
  // friction channel, so its absence means the resolver changed under us — and
  // guessing a folder would put the filing somewhere nothing ingests, which is the
  // silent loss this whole change is about.
  if (!channel) throw new Error(`no "${FRICTION_CHANNEL}" channel resolved for this vault — it is declared in src/adapters/channels.ts`);
  return channel.dir;
}

/**
 * File one friction event into the vault's friction channel. Returns the path
 * written. Throws on an empty note or an unknown kind — a filing that says nothing is
 * worse than no filing, because it inflates the count the assumption test reads.
 */
export function fileFriction(vaultDir: string, filing: FrictionFiling): string {
  if (!FRICTION_KINDS.includes(filing.kind)) {
    throw new Error(`unknown friction kind "${filing.kind}" — use one of: ${FRICTION_KINDS.join(", ")}`);
  }
  const note = clean(filing.note ?? "", MAX_NOTE_CHARS);
  if (!note) throw new Error("a friction filing needs a note — one line describing what went wrong");

  const dir = path.resolve(vaultDir);
  const inboxDir = frictionDir(dir);
  fs.mkdirSync(inboxDir, { recursive: true });

  const at = filing.at ?? new Date().toISOString();
  const day = at.slice(0, 10);
  const context = filing.context ? clean(filing.context, MAX_CONTEXT_CHARS) : "";
  const source = filing.source ? clean(filing.source, 120) : "";

  const body = [
    `# Friction (${filing.kind}): ${note}`,
    "",
    `- **kind:** ${filing.kind}`,
    `- **filed:** ${at}`,
    ...(source ? [`- **filed by:** ${source}`] : []),
    "",
    context ? `**Context:** ${context}` : "",
    "",
    "Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by",
    "the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent",
    "failed to notice or chose not to file.",
    "",
  ].join("\n");

  const target = uniquePath(inboxDir, `${day}-friction-${slug(note)}`);
  fs.writeFileSync(target, body, "utf8");
  return target;
}
