/**
 * Ruleset proposals — the agent drafts a change to its own rules; a human adopts it.
 *
 * The friction channel gives the agent a place to say where it got stuck. This is
 * the next step of that loop: when the same friction keeps recurring, the agent may
 * draft the rule change it wishes existed — as a reviewable proposal file, with the
 * friction filings that triggered it attached by id — and a human accepts or rejects
 * it in one CLI action. Until that action happens, NOTHING changes: a pending
 * proposal does not alter the ruleset a pass executes, which is the property that
 * keeps this from being the agent rewriting its own constitution.
 *
 * Three containment decisions, made here and enforced here:
 *
 * - **Evidence is mandatory.** A proposal with no friction filings behind it is an
 *   opinion, and the review it asks a human for would be a review of prose against
 *   nothing. Every proposal names the `INBOX:friction/…` ids that triggered it, and
 *   each id must resolve to a filing that exists on disk — a dangling citation is
 *   refused at drafting time, not discovered at review time.
 * - **Prose rule sections only.** A proposal may add to or replace text in the
 *   ruleset's rule lists ({@link PROPOSABLE_SECTIONS}). It may never touch
 *   `skillTools` — the tool grant list — nor the structural sections (`layers`,
 *   `glossary`, `obsidianFormat`, `assumptionCategories`). A drafting surface that
 *   could propose widening its own tool grants, with adoption one click away, is a
 *   self-widening surface; the grant list keeps its own argued-in-source process.
 * - **Adoption is a human's CLI action.** `decideRulesetProposal` is reachable from
 *   `ost-agent proposal` and from nowhere on the MCP surface — the agent must never
 *   adopt its own proposal, and the spec pins that no `proposal` tool exists in
 *   `MCP_TOOL_NAMES`. A decision needs a name on it (`by`), and a decided proposal
 *   is never re-decided: the one action is also the only action.
 *
 * What adoption reaches: {@link effectiveRuleset} folds accepted proposals into the
 * ruleset `buildPassContext` puts on every `PassContext`, so the next pass runs the
 * amended rules without a restart or a source edit. The generated `SKILL.md` still
 * renders from `src/knowledge/ruleset.ts` alone — porting an adopted rule into
 * source is the durable form, and the CLI says so at the moment of acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { OST_RULESET, type OstRuleset } from "./ruleset.js";
import { parseFrontmatter } from "../ost/frontmatter.js";
import { channelIdPrefix, FRICTION_CHANNEL, FRICTION_CHANNEL_PATH } from "../adapters/channels.js";
import { redactSecrets } from "../adapters/transcript.js";

/** Where proposals live: inside the vault, committed with the tree, like friction. */
export const PROPOSALS_DIR = ".ost-agent/proposals";

/**
 * The sections a proposal may touch: the rule PROSE lists, and nothing else.
 * `skillTools` is the deliberate omission — see the module comment.
 */
export const PROPOSABLE_SECTIONS = [
  "firstRun",
  "treeRules",
  "opportunityRules",
  "solutionRules",
  "assumptionRules",
  "prioritization",
  "cadence",
  "agentMust",
  "agentMustNot",
] as const;

export type ProposableSection = (typeof PROPOSABLE_SECTIONS)[number];

export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface RulesetProposalDraft {
  section: ProposableSection;
  /** The proposed rule text, in full — what would be appended or substituted. */
  rule: string;
  /** Exact text of the current rule this replaces. Absent ⇒ the rule is added. */
  replaces?: string;
  /** Why — what kept going wrong, in the drafter's words. */
  rationale: string;
  /** Friction evidence ids (`INBOX:friction/<file>` or bare filenames) that triggered this. */
  evidence: string[];
  /** Which loop/process/session drafted this. */
  source?: string;
  /** ISO timestamp; defaults to now. Injectable so tests are deterministic. */
  at?: string;
}

export interface RulesetProposal {
  /** Filename minus `.md` — what the human types to decide it. */
  id: string;
  status: ProposalStatus;
  section: ProposableSection;
  rule: string;
  replaces?: string;
  rationale: string;
  evidence: string[];
  source?: string;
  created: string;
  decidedBy?: string;
  decidedAt?: string;
  /** Absolute path of the proposal file. */
  file: string;
}

/**
 * The ruleset shape a pass actually receives. Identical to {@link OstRuleset}
 * except that the proposable sections are widened from literal tuples to string
 * arrays — an adopted rule is a string the source file never contained.
 */
export type EffectiveRuleset = Omit<OstRuleset, ProposableSection> & {
  readonly [K in ProposableSection]: readonly string[];
};

/**
 * Bounds that REFUSE rather than clip. A friction note clipped mid-sentence is
 * still evidence of the pain; a rule clipped mid-sentence would be ADOPTED
 * mid-sentence — the reviewed text and the executed text must be the same bytes,
 * so an overlong draft is turned away whole and nothing here is ever truncated.
 * Sized above the longest rule the shipped ruleset carries (~1.5k chars), so any
 * current rule can be named for replacement by a similarly-sized successor.
 */
export const MAX_RULE_CHARS = 2000;
export const MAX_RATIONALE_CHARS = 2000;
export const MAX_SOURCE_CHARS = 120;

function sanitized(text: string, label: string, max: number): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (flat.length > max) {
    throw new Error(
      `${label} is ${flat.length} characters and the cap is ${max} — nothing here is clipped, ` +
        "because what a human reviews must be exactly what would be adopted. Shorten it and redraft.",
    );
  }
  return flat;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "proposal"
  );
}

function isProposableSection(s: string): s is ProposableSection {
  return (PROPOSABLE_SECTIONS as readonly string[]).includes(s);
}

/**
 * Normalize one cited filing to its evidence id, refusing anything that does not
 * resolve to a file in the friction channel. Accepts the full `INBOX:friction/…`
 * id or the bare filename `fileFriction` returned, with or without `.md`.
 */
function resolveFrictionId(vaultDir: string, cited: string): string {
  const prefix = channelIdPrefix(FRICTION_CHANNEL);
  const trimmed = cited.trim();
  let name = trimmed.toLowerCase().startsWith(prefix.toLowerCase()) ? trimmed.slice(prefix.length) : trimmed;
  name = path.basename(name);
  if (!name.endsWith(".md")) name = `${name}.md`;
  const file = path.join(vaultDir, FRICTION_CHANNEL_PATH, name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `friction evidence "${cited}" does not resolve to a filing in ${FRICTION_CHANNEL_PATH}/ — ` +
        "a proposal may only cite friction that was actually filed. File it first (`ost-agent friction`), then cite it.",
    );
  }
  return `${prefix}${name}`;
}

/** Pick a filename that does not exist yet — an earlier proposal is never replaced. */
function uniquePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}.md`);
  }
  return candidate;
}

/**
 * Draft one ruleset proposal into the vault. Returns the proposal as written.
 *
 * Everything that would make the review pointless is refused here rather than
 * discovered by the reviewer: an off-limits section, an empty rule or rationale,
 * missing or dangling friction evidence, a `replaces` that matches no current rule.
 */
export function draftRulesetProposal(vaultDir: string, draft: RulesetProposalDraft): RulesetProposal {
  if (!isProposableSection(draft.section)) {
    throw new Error(
      `"${draft.section}" is not a section a proposal may touch — use one of: ${PROPOSABLE_SECTIONS.join(", ")}. ` +
        "The tool grant list (skillTools) and the structural sections are off-limits by design: " +
        "a drafting surface that could propose widening its own grants would be a self-widening surface.",
    );
  }
  const rule = sanitized(draft.rule ?? "", "the proposed rule", MAX_RULE_CHARS);
  if (!rule) throw new Error("a proposal needs the proposed rule text, in full — an empty rule reviews nothing");
  const rationale = sanitized(draft.rationale ?? "", "the rationale", MAX_RATIONALE_CHARS);
  if (!rationale) throw new Error("a proposal needs a rationale — what kept going wrong, in the drafter's words");

  const dir = path.resolve(vaultDir);
  const cited = (draft.evidence ?? []).map((e) => e.trim()).filter((e) => e.length > 0);
  if (cited.length === 0) {
    throw new Error(
      "a proposal must carry the friction evidence ids that triggered it — with none, adoption would be " +
        "a decision made against prose rather than against evidence. File the friction first (`ost-agent friction`).",
    );
  }
  const evidence = [...new Set(cited.map((c) => resolveFrictionId(dir, c)))];

  const replaces = draft.replaces === undefined ? undefined : sanitized(draft.replaces, "the rule to replace", MAX_RULE_CHARS);
  if (replaces !== undefined) {
    const current = OST_RULESET[draft.section] as readonly string[];
    if (!current.includes(replaces)) {
      throw new Error(
        `nothing in "${draft.section}" matches the text this proposal claims to replace — ` +
          "quote the current rule exactly, or omit --replaces to add a new rule instead.",
      );
    }
  }

  const at = draft.at ?? new Date().toISOString();
  const proposalsDir = path.join(dir, PROPOSALS_DIR);
  fs.mkdirSync(proposalsDir, { recursive: true });
  const file = uniquePath(proposalsDir, `${at.slice(0, 10)}-proposal-${slug(rule)}`);
  const id = path.basename(file, ".md");
  const source = draft.source ? sanitized(draft.source, "the source", MAX_SOURCE_CHARS) : undefined;

  const body = [
    "---",
    `id: ${JSON.stringify(id)}`,
    "status: pending",
    `section: ${draft.section}`,
    `rule: ${JSON.stringify(rule)}`,
    ...(replaces !== undefined ? [`replaces: ${JSON.stringify(replaces)}`] : []),
    `rationale: ${JSON.stringify(rationale)}`,
    "evidence:",
    ...evidence.map((e) => `  - ${JSON.stringify(e)}`),
    ...(source ? [`source: ${JSON.stringify(source)}`] : []),
    `created: ${JSON.stringify(at)}`,
    "---",
    "",
    `# Ruleset proposal: ${rule.length > 80 ? `${rule.slice(0, 80)}…` : rule}`,
    "",
    `- **section:** ${draft.section}`,
    `- **change:** ${replaces !== undefined ? "replace an existing rule" : "add a new rule"}`,
    ...(source ? [`- **drafted by:** ${source}`] : []),
    "",
    ...(replaces !== undefined ? ["**Current rule:**", "", `> ${replaces}`, ""] : []),
    "**Proposed rule:**",
    "",
    `> ${rule}`,
    "",
    `**Why:** ${rationale}`,
    "",
    "**Friction that triggered this:**",
    "",
    ...evidence.map((e) => `- \`${e}\``),
    "",
    "Drafted by the agent; PENDING until a human decides it. A pending proposal changes",
    "nothing — the agent keeps running the current ruleset. To decide it in one action:",
    "",
    "```",
    `ost-agent proposal "${id}" --accept -b "<you>"   # or --reject`,
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(file, body, "utf8");
  return { id, status: "pending", section: draft.section, rule, ...(replaces !== undefined ? { replaces } : {}), rationale, evidence, ...(source ? { source } : {}), created: at, file };
}

export interface ProposalScan {
  proposals: RulesetProposal[];
  /** Files in the proposals folder that could not be parsed — named, never silently dropped. */
  unreadable: string[];
}

/** Read every proposal in the vault, oldest first. A vault with none reads as empty. */
export function readRulesetProposals(vaultDir: string): ProposalScan {
  const dir = path.join(path.resolve(vaultDir), PROPOSALS_DIR);
  if (!fs.existsSync(dir)) return { proposals: [], unreadable: [] };
  const proposals: RulesetProposal[] = [];
  const unreadable: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(dir, name);
    try {
      const data = parseFrontmatter(fs.readFileSync(file, "utf8")).data as Record<string, unknown>;
      const section = String(data.section ?? "");
      const status = String(data.status ?? "");
      const rule = String(data.rule ?? "");
      if (!isProposableSection(section) || !rule) throw new Error("not a proposal");
      proposals.push({
        id: String(data.id ?? path.basename(name, ".md")),
        // Fail closed: an unrecognised status reads as pending — the state that changes nothing.
        status: status === "accepted" || status === "rejected" ? status : "pending",
        section,
        rule,
        ...(data.replaces !== undefined ? { replaces: String(data.replaces) } : {}),
        rationale: String(data.rationale ?? ""),
        evidence: Array.isArray(data.evidence) ? data.evidence.map(String) : [],
        ...(data.source !== undefined ? { source: String(data.source) } : {}),
        created: String(data.created ?? ""),
        ...(data.decidedBy !== undefined ? { decidedBy: String(data.decidedBy) } : {}),
        ...(data.decidedAt !== undefined ? { decidedAt: String(data.decidedAt) } : {}),
        file,
      });
    } catch {
      unreadable.push(name);
    }
  }
  return { proposals, unreadable };
}

export interface ProposalDecision {
  decision: "accept" | "reject";
  /** Who decided — an unattributed adoption cannot be told apart from a fabricated one. */
  by: string;
  /** ISO timestamp; defaults to now. Injectable so tests are deterministic. */
  at?: string;
}

/**
 * Decide one pending proposal — the human's one action. Refuses an unattributed
 * decision and refuses to re-decide: a proposal is decided exactly once.
 */
export function decideRulesetProposal(vaultDir: string, id: string, decision: ProposalDecision): RulesetProposal {
  const by = decision.by?.trim();
  if (!by) throw new Error("a decision needs a name on it (-b) — an unattributed adoption cannot be trusted");
  const { proposals } = readRulesetProposals(vaultDir);
  const target = proposals.find((p) => p.id === id.trim());
  if (!target) {
    throw new Error(`no proposal "${id}" in ${PROPOSALS_DIR}/ — \`ost-agent proposals\` lists what is there`);
  }
  if (target.status !== "pending") {
    throw new Error(
      `proposal "${id}" was already ${target.status}${target.decidedBy ? ` by ${target.decidedBy}` : ""} — ` +
        "a proposal is decided exactly once; draft a new one to revisit it.",
    );
  }

  const at = decision.at ?? new Date().toISOString();
  const status: ProposalStatus = decision.decision === "accept" ? "accepted" : "rejected";
  const raw = fs.readFileSync(target.file, "utf8");
  // The frontmatter this module wrote: flip `status:` in place and record who/when.
  const updated = raw.replace(/^status: pending$/m, [`status: ${status}`, `decidedBy: ${JSON.stringify(by)}`, `decidedAt: ${JSON.stringify(at)}`].join("\n"));
  if (updated === raw) {
    throw new Error(`proposal "${id}" has no pending marker to flip — its file was edited by hand; decide it by editing the file`);
  }
  fs.writeFileSync(target.file, `${updated}\n- ${at.slice(0, 10)} **${status}** by ${by}\n`, "utf8");
  return { ...target, status, decidedBy: by, decidedAt: at };
}

export interface EffectiveRulesetResult {
  ruleset: EffectiveRuleset;
  /** Ids of the accepted proposals that were folded in, in application order. */
  adopted: string[];
  /**
   * Accepted proposals that could NOT be applied, with the reason — a `replaces`
   * whose target text has since changed, never silently dropped.
   */
  problems: string[];
}

/**
 * The ruleset a pass executes: `OST_RULESET` with every ACCEPTED proposal folded
 * in. Pending and rejected proposals change nothing — that is the safety property
 * the assumption test names, and it is enforced here by only ever reading
 * `status: accepted`.
 */
export function effectiveRuleset(vaultDir: string): EffectiveRulesetResult {
  const { proposals } = readRulesetProposals(vaultDir);
  const accepted = proposals
    .filter((p) => p.status === "accepted")
    .sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? "") || a.id.localeCompare(b.id));
  if (accepted.length === 0) return { ruleset: OST_RULESET, adopted: [], problems: [] };

  const sections = Object.fromEntries(
    PROPOSABLE_SECTIONS.map((s) => [s, [...(OST_RULESET[s] as readonly string[])]]),
  ) as Record<ProposableSection, string[]>;
  const adopted: string[] = [];
  const problems: string[] = [];
  for (const p of accepted) {
    const rules = sections[p.section];
    if (p.replaces !== undefined) {
      const i = rules.indexOf(p.replaces);
      if (i === -1) {
        problems.push(
          `accepted proposal "${p.id}" replaces text that is no longer in "${p.section}" — skipped; re-draft it against the current rule.`,
        );
        continue;
      }
      rules[i] = p.rule;
    } else {
      rules.push(p.rule);
    }
    adopted.push(p.id);
  }
  return { ruleset: { ...OST_RULESET, ...sections }, adopted, problems };
}
