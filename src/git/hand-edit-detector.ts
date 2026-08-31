/**
 * Hand-edit drift — what a human changed in the vault between passes, read out
 * of git and nothing else.
 *
 * **The incident.** On 2026-07-24 a person opened this vault in Obsidian and did
 * two ordinary things: renamed an umbrella Opportunity to the sentence they
 * actually meant, and changed its `type:` from `Opportunity` to `Metric`. Both
 * edits are reasonable. The result was that `readTree` returned a tree with that
 * node and its eight outgoing edges missing, four Opportunities and three
 * Solutions surfaced as orphans, the Outcome carried a dangling link — and
 * nothing failed. The next unattended pass would have run happily against a tree
 * with a hole in it.
 *
 * **Reporting, not repairing, and the reason is not caution.** A hand edit is the
 * closest thing this product has to an interview. Read as a diff, "renamed to the
 * goal sentence, retyped `Metric`" is an operator saying *this node is my goal,
 * it is a metric, and your schema has no word for that.* Read as corruption to be
 * reverted, it is noise — and the product would have thrown away its most direct
 * piece of user feedback to make a hygiene counter go down. So this module has no
 * verb. It reads.
 *
 * **What it may use.** Only what git already records: subjects, diffs, dates, the
 * working tree. No sidecar file of "what the pass last wrote", because that is
 * duplicate state that can itself drift and it makes the append-only trust story
 * harder to tell. Whether git alone carries enough signal is the assumption this
 * was built to test, and the answer is a qualified yes — see {@link classifyCommit}
 * for the boundary, which is real and is not closable from here.
 *
 * ## The posture: positive evidence or silence
 *
 * The pre-committed threshold is **zero false positives on clean history**, with
 * false negatives acceptable *provided they fail toward silence rather than toward
 * a confident wrong story about what the human meant.* A drift report that cries
 * wolf is worse than no drift report, because the operator learns to skip it and
 * then misses the real one — the exact fate of the unmappable evidence item in
 * this vault's sibling branch.
 *
 * So every commit is the pass's own work until something positively says
 * otherwise, and the three things that say otherwise are named in
 * {@link DriftEvidence}. Everything ambiguous — a merge, a commit touching no node
 * file, a shape nobody anticipated — is silence.
 *
 * ## What it finds on the vault it was built from
 *
 * `test/git/hand-edit-detector.test.ts` pins the behaviour on fixtures. The number
 * that says whether the rule survives contact is what it does to the real thing:
 * over this vault's own history, **54 of 3,675 commits are flagged** — 51
 * `unexplained-subject`, 3 `uncorroborated-diff`, none of them a commit the MCP
 * surface wrote through its normal path. Two of the three `uncorroborated-diff`
 * hits are worth naming because they are not what the rule was aimed at: an
 * unrelated dirty file was swept into an `mcp:` commit by `git add -A`, so a
 * stranger's edit is committed under a tool call's name. That is criterion D5's
 * failure, sitting in the history, found by a rule written for something else. See
 * {@link classifyCommit} for what the 51 divide into and why the verdict is called
 * `outside` rather than `human`.
 *
 * ## Node terms, not file terms
 *
 * "2 files changed" is not actionable. "the Outcome's link target is now empty and
 * a new node carries its 8 links" is. Every change is therefore reported as a
 * {@link NodeChange}: which node, which links arrived and left, which frontmatter
 * fields moved, and whether the node stopped being visible to the tree at all.
 * The file path never leaves this module.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { LAYERS, parseNodeContent } from "../ost/node.js";
import { parseFrontmatter } from "../ost/frontmatter.js";
import { canonicalTitle } from "../ost/sanitize.js";
import { toolFromSubject } from "../loop/pass-shape.js";

/**
 * Tool calls whose write footprint is exactly the nodes their commit subject
 * names — so a root-level node file in the diff that the subject does not name is
 * a change no such call could have made.
 *
 * Listed rather than inferred from the MCP surface, and deliberately short. The
 * rule below turns membership here into an accusation, so a tool whose blast
 * radius can legitimately exceed its subject must NOT be on this list:
 * `ost_merge_nodes` repoints every inbound link to the node it retires and names
 * only two titles, and `ost_ingest_inbox` writes under `.ost-agent/` where the
 * rule does not look. Both are absent for that reason, and a tool added to the
 * MCP surface and to neither list is simply exempt — unlisted means uncorroborated
 * means silent, which is the direction the threshold asks us to fail in.
 */
export const NARROW_FOOTPRINT_CALLS: readonly string[] = [
  "ost_create_node",
  "ost_append_to_node",
  "ost_annotate",
  "ost_edit_node",
  "ost_set_status",
  "ost_set_evidence",
  "ost_link_nodes",
  "ost_unlink_nodes",
];

/**
 * Commit subjects written by a machine that is not the MCP surface.
 *
 * `chore(instruments)` is the build loop appending a result line to an
 * `## Instrument Log`; it is 549 of this vault's 3,674 commits and it touches node
 * files, so without it here every instrument run would read as a human edit and
 * the report would be 15% noise on day one. Merge subjects are here because a
 * merge commit's diff is not read at all (see {@link changedNodeFiles}) and a
 * merge that reached the vault by hand is a change to *which* commits are
 * reachable, not a change nobody can account for.
 */
const MACHINE_SUBJECT_FORMS: readonly RegExp[] = [
  /^chore\(instruments\):/,
  /^Merge branch\b/,
  /^Merge pull request\b/,
  /^Merge remote-tracking branch\b/,
];

/** Why a change was read as something other than the pass's own work. */
export type DriftEvidence =
  /** The subject is not one the tool surface produces. */
  | "unexplained-subject"
  /** An `mcp:` subject whose diff carries node files that call could not have written. */
  | "uncorroborated-diff"
  /** The commit was rewritten after it was first authored — an amend, or a rebase. */
  | "rewritten-commit"
  /** Uncommitted changes sitting in the working tree in front of the pass. */
  | "uncommitted";

/** Where a drift entry was seen. */
export type DriftWhere = { kind: "commit"; sha: string; subject: string } | { kind: "working-tree" };

/** What happened to one node, in the vocabulary of nodes and links. */
export interface NodeChange {
  /** The node's title — never its path. */
  title: string;
  kind: "added" | "removed" | "emptied" | "renamed" | "edited";
  /** For a rename: the title this node's content now lives under. */
  renamedTo?: string;
  /** Child edges that appeared. */
  linksAdded: string[];
  /** Child edges that vanished. */
  linksRemoved: string[];
  /** Frontmatter fields whose value moved, rendered `field: from → to`. */
  fieldsChanged: string[];
  /**
   * True when the node stopped being readable as a node — its `type:` is now a
   * value the schema has no word for, so every reader downstream simply stops
   * seeing it. This is the incident's own shape and the single most important
   * thing this report can say.
   */
  becameInvisible: boolean;
  /** One line, in node and link terms, fit to print. */
  summary: string;
}

/** One change no pass of the tool surface accounts for, with the nodes it moved. */
export interface DriftEntry {
  where: DriftWhere;
  evidence: DriftEvidence;
  /** The sentence that says why this was not read as the pass's own work. */
  why: string;
  nodes: NodeChange[];
}

export interface DriftReport {
  /** True when nothing in the vault looks like a human edit. */
  silent: boolean;
  entries: DriftEntry[];
  /** How many commits were read, so a caller can see the window that was searched. */
  commitsRead: number;
  /**
   * Set when the history could not be read at all — not a git checkout, no
   * commits, git missing. Never folded into `silent`: "nothing drifted" and
   * "nobody could tell whether anything drifted" are different facts and a caller
   * acting on the second as though it were the first is the failure this whole
   * module exists to prevent.
   */
  unreadable?: string;
}

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

/** A vault-root `.md` path is a node file; anything nested or non-markdown is not. */
function isNodeFile(filePath: string): boolean {
  return filePath.endsWith(".md") && !filePath.includes("/");
}

/** The node title a vault-root path carries — the filename is the title. */
function titleOf(filePath: string): string {
  return filePath.slice(0, -3);
}

/**
 * Does this commit subject name this node?
 *
 * Every tool result quotes the titles it touched (`created Solution "X" under
 * "P"`), so the obvious reading is to pull the quoted spans out. That is wrong on
 * this vault's real history and the counter-example is on record: the node
 * `The harness can reliably tell "created by this session" apart from
 * "pre-existing, this session just wrote to it"` has quotes IN ITS TITLE, so
 * splitting on quotes yields the claims `The harness can reliably tell `,
 * ` apart from ` and ` under ` — and the commit that created it reads as an
 * uncorroborated diff. One accusation, aimed at the tool surface, produced by
 * punctuation.
 *
 * So the subject is normalised the way {@link ../ost/sanitize.ts#sanitizeTitle}
 * normalises a title — which replaces `"` and `:` with spaces, among others — and
 * the node's stored name is looked for inside it. A stored title IS the filename,
 * so this asks the only question that matters: does the subject contain the name
 * this node is filed under. Substring rather than equality means a short title
 * could match a subject that never meant it; that error direction is a missed
 * accusation, which is the one the threshold permits.
 */
function subjectNames(subject: string, title: string): boolean {
  const needle = canonicalTitle(title);
  if (needle === null) return false;
  return normalizeLikeATitle(subject).includes(needle);
}

/**
 * The character handling of `sanitizeTitle`, without its length clamp or its
 * throw — a subject is longer than a filename and must never fail to normalise.
 */
function normalizeLikeATitle(text: string): string {
  return text
    .replace(new RegExp("[\\u0000-\\u001F\\u007F]", "g"), " ")
    .replace(/[/\\]+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/[<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Node files a commit changed, with their status, renames turned off.
 *
 * `--no-renames` is deliberate and matches `./rename-topology.ts`: the rename this
 * report cares about is the one Obsidian and git's own `-M` heuristic both handle
 * badly, so leaning on `-M` here would hide the case worth seeing. A merge commit
 * yields nothing — `git show` prints no diff for one without `-m`/`--cc` — and
 * that silence is the intended reading, not an oversight.
 */
async function changedNodeFiles(g: SimpleGit, commit: string): Promise<{ status: string; path: string }[]> {
  let raw: string;
  try {
    raw = await g.raw(["show", "--no-renames", "--name-status", "--format=", commit]);
  } catch {
    return [];
  }
  const out: { status: string; path: string }[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const status = parts[0];
    const filePath = parts[parts.length - 1];
    if (!status || !filePath || !isNodeFile(filePath)) continue;
    out.push({ status: status[0], path: filePath });
  }
  return out;
}

/** File content at `ref:filePath`, or null when it does not exist there. */
async function blobAt(g: SimpleGit, ref: string, filePath: string): Promise<string | null> {
  try {
    return await g.raw(["show", `${ref}:${filePath}`]);
  } catch {
    return null;
  }
}

/** What one side of a node file's diff says about the node. */
interface NodeSide {
  present: boolean;
  /** The declared `type:`, verbatim — `Metric` is the whole signal, not "unknown". */
  type: string | undefined;
  /** Every scalar frontmatter field, so a frontmatter-only edit has something to name. */
  fields: Map<string, string>;
  links: string[];
  body: string;
}

const ABSENT: NodeSide = { present: false, type: undefined, fields: new Map(), links: [], body: "" };

/**
 * Read one side of a node file.
 *
 * Parses through the same `parseNodeContent` a live vault read uses rather than a
 * second near-identical parser, and passes the file's *declared* type as the layer
 * tag so a `type: Metric` file drops `#Metric` exactly the way a Solution drops
 * `#Solution` — the reader must be able to describe a node whose type it does not
 * recognise, which is the whole case in hand.
 */
function readSide(content: string | null): NodeSide {
  if (content === null || content.trim() === "") return { ...ABSENT, present: content !== null };
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(content);
  } catch {
    return { present: true, type: undefined, fields: new Map(), links: [], body: content.trim() };
  }
  const data = parsed.data as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : undefined;
  const fields = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    fields.set(key, value instanceof Date ? value.toISOString().slice(0, 10) : String(value));
  }
  const { links, body } = parseNodeContent(parsed.content, type ?? "");
  return { present: true, type, fields, links, body };
}

/** A type the schema has a word for. A node carrying anything else is invisible to every reader. */
function isKnownType(type: string | undefined): boolean {
  return type !== undefined && (LAYERS as readonly string[]).includes(type);
}

function missingFrom(a: readonly string[], b: readonly string[]): string[] {
  const have = new Set(b.map((t) => canonicalTitle(t) ?? t));
  return a.filter((t) => !have.has(canonicalTitle(t) ?? t));
}

/** Compare two sides of one node file into a change described in node terms. */
function describeChange(title: string, before: NodeSide, after: NodeSide): NodeChange | null {
  const linksAdded = missingFrom(after.links, before.links);
  const linksRemoved = missingFrom(before.links, after.links);
  const fieldsChanged: string[] = [];
  for (const key of new Set([...before.fields.keys(), ...after.fields.keys()])) {
    const from = before.fields.get(key);
    const to = after.fields.get(key);
    if (from === to) continue;
    fieldsChanged.push(`${key}: ${from ?? "(unset)"} → ${to ?? "(unset)"}`);
  }
  const bodyChanged = before.body !== after.body;
  const becameInvisible = isKnownType(before.type) && !isKnownType(after.type) && after.present;

  let kind: NodeChange["kind"];
  if (!before.present && after.present) kind = "added";
  else if (before.present && !after.present) kind = "removed";
  else if (before.links.length > 0 && after.present && after.links.length === 0 && after.body === "" && after.type === undefined) {
    kind = "emptied";
  } else if (linksAdded.length === 0 && linksRemoved.length === 0 && fieldsChanged.length === 0 && !bodyChanged) {
    return null;
  } else kind = "edited";

  const parts: string[] = [];
  if (kind === "added") parts.push(`node "${title}" appeared${after.links.length > 0 ? ` carrying ${after.links.length} link(s)` : ""}`);
  else if (kind === "removed") parts.push(`node "${title}" is gone, taking ${before.links.length} link(s) with it`);
  else if (kind === "emptied") parts.push(`node "${title}" was emptied — its ${before.links.length} link(s) no longer exist`);
  if (becameInvisible) {
    parts.push(
      `type: ${before.type} → ${after.type ?? "(unset)"} — the schema has no such type, so "${title}" and its ` +
        `${after.links.length} link(s) are invisible to every reader of the tree`,
    );
  }
  if (linksAdded.length > 0) parts.push(`links added: ${linksAdded.map((l) => `[[${l}]]`).join(", ")}`);
  if (linksRemoved.length > 0) parts.push(`links removed: ${linksRemoved.map((l) => `[[${l}]]`).join(", ")}`);
  const otherFields = becameInvisible ? fieldsChanged.filter((f) => !f.startsWith("type: ")) : fieldsChanged;
  if (otherFields.length > 0) parts.push(otherFields.join("; "));
  if (parts.length === 0 && bodyChanged) parts.push("prose changed, no edges or fields moved");

  return {
    title,
    kind,
    linksAdded,
    linksRemoved,
    fieldsChanged,
    becameInvisible,
    summary: `"${title}": ${parts.join("; ")}`,
  };
}

/**
 * Pair a vanished node with an arrived one carrying its link set, and fold the
 * two into a single rename.
 *
 * The signal is the outgoing LINK SET, not title distance — a rename does not
 * touch what a node points at, and the incident that motivated this went from
 * "Trust an unmonitored agent enough to walk away" to a completely different
 * sentence, so title similarity would have found nothing. Same reasoning as
 * `./rename-topology.ts`, applied here to the case that leaves no empty file
 * behind: Obsidian deletes the old path, writes the new one, and rewrites every
 * inbound `[[link]]` in the same commit.
 */
function foldRenames(changes: NodeChange[]): NodeChange[] {
  const gone = changes.filter((c) => (c.kind === "removed" || c.kind === "emptied") && c.linksRemoved.length > 0);
  const arrived = changes.filter((c) => c.kind === "added" && c.linksAdded.length > 0);
  const folded = new Set<NodeChange>();
  const renames: NodeChange[] = [];

  for (const from of gone) {
    const to = arrived.find(
      (a) =>
        !folded.has(a) &&
        a.linksAdded.length === from.linksRemoved.length &&
        missingFrom(a.linksAdded, from.linksRemoved).length === 0,
    );
    if (!to) continue;
    folded.add(from);
    folded.add(to);
    // Inbound edges that were repointed in the same change — the half a reader
    // needs to know the rest of the tree came with it rather than being stranded.
    const inbound = changes
      .filter((c) => c !== from && c !== to && c.linksRemoved.includes(from.title) && c.linksAdded.includes(to.title))
      .map((c) => c.title);
    for (const c of changes) if (inbound.includes(c.title)) folded.add(c);
    renames.push({
      title: from.title,
      kind: "renamed",
      renamedTo: to.title,
      linksAdded: [],
      linksRemoved: [],
      fieldsChanged: [],
      becameInvisible: false,
      summary:
        `"${from.title}" is now "${to.title}" — same ${from.linksRemoved.length} outgoing link(s), so this is a rename` +
        (inbound.length > 0
          ? `; ${inbound.length} inbound link(s) were repointed with it (from ${inbound.map((t) => `"${t}"`).join(", ")})`
          : "; no inbound link was repointed, so anything still pointing at the old title now dangles"),
    });
  }

  return [...renames, ...changes.filter((c) => !folded.has(c))];
}

/** Node-level changes one commit made, folded for renames. */
async function nodeChangesInCommit(g: SimpleGit, commit: string): Promise<NodeChange[]> {
  const changed = await changedNodeFiles(g, commit);
  const changes: NodeChange[] = [];
  for (const file of changed) {
    const before = readSide(await blobAt(g, `${commit}~1`, file.path));
    const after = readSide(file.status === "D" ? null : await blobAt(g, commit, file.path));
    const change = describeChange(titleOf(file.path), before, after);
    if (change) changes.push(change);
  }
  return foldRenames(changes);
}

/**
 * Was this commit the tool surface's own work, or did something else make it?
 *
 * **`tool-surface` unless something positively says otherwise**, and exactly three
 * things do:
 *
 *   1. **`unexplained-subject`** — the subject matches no form the tool surface
 *      produces, and the commit touched node files. The allowlist is a contract
 *      with this repository rather than a guess about git, the same way
 *      `../loop/pass-shape.ts#toolFromSubject` is; a commit that touched no node
 *      file is silent whatever its subject says.
 *   2. **`uncorroborated-diff`** — the subject claims a narrow-footprint tool call
 *      and the diff carries node files that call did not name. This is the only
 *      check that reads a subject against the diff rather than believing it, and
 *      it is what catches a hand edit wearing an `mcp:` subject.
 *   3. **`rewritten-commit`** — the committer timestamp is later than the author
 *      timestamp, so the commit was re-made after it was first authored. Measured
 *      before it was trusted: 2 of this vault's 3,674 commits show the skew, and
 *      both are already caught by rule 1, so on the real corpus this adds no false
 *      positive. It is not free of exposure — a rebase sets it on every commit it
 *      moves — and a vault that starts rebasing will see this fire broadly. That
 *      is a visible, explicable over-report rather than a silent miss, which is
 *      the side of the trade the threshold asks for.
 *
 * ## `outside` is not the same claim as "a human did this"
 *
 * The solution node reasons that "any commit that does not look like [an `mcp:`
 * commit] is a human edit", and running this over the vault's own 3,675 commits
 * shows that is one step too far. 54 commits are flagged; the 51
 * `unexplained-subject` ones divide into at least three populations — a person
 * editing in Obsidian, a person running a CLI write (`set-outcome:`, `repair:`),
 * and an agent pass that wrote its own commit subject instead of going through the
 * tool surface (`P2 ambient (twenty-passes 3/20)`, `ost: map v0.7.0 …`). Git
 * separates *the tool surface wrote this* from *something else did*. It does not
 * separate human from agent inside the second group, and nothing it records could.
 *
 * That is not a defect for the purpose at hand: every one of those is a change the
 * pass about to run did not make and should see. But the verdict is named `outside`
 * rather than `human` so no caller downstream reads a stronger claim off it than
 * the evidence carries.
 *
 * ## The boundary, stated rather than buried
 *
 * A person who commits a hand edit to node `X` under the subject
 * `mcp: ost_append_to_node — appended to "X"` is invisible here and cannot be made
 * visible from git: every byte git records about that commit is identical to the
 * agent commit it imitates. Rule 2 catches the *plausible* forgery — a real
 * subject copied onto a different edit — and not the *careful* one. Closing it
 * needs a signature over the commit, which is new state and a different assumption
 * from the one this was built to test.
 */
export function classifyCommit(input: {
  subject: string;
  authoredAt: number;
  committedAt: number;
  changedTitles: readonly string[];
}): { author: "tool-surface" } | { author: "outside"; evidence: DriftEvidence; why: string } {
  const { subject, changedTitles } = input;
  const tool = toolFromSubject(subject);

  if (tool === undefined) {
    if (MACHINE_SUBJECT_FORMS.some((re) => re.test(subject))) return { author: "tool-surface" };
    if (changedTitles.length === 0) return { author: "tool-surface" };
    return {
      author: "outside",
      evidence: "unexplained-subject",
      why: `no tool call explains this commit — "${subject}" is not a subject the tool surface produces, and it changed ${changedTitles.length} node(s)`,
    };
  }

  if (NARROW_FOOTPRINT_CALLS.includes(tool) && changedTitles.length > 0) {
    const unexplained = changedTitles.filter((t) => !subjectNames(subject, t));
    if (unexplained.length > 0) {
      const named = unexplained.map((t) => `"${t}"`).join(", ");
      return {
        author: "outside",
        evidence: "uncorroborated-diff",
        why:
          unexplained.length === changedTitles.length
            ? `the subject claims ${tool}, and not one of the ${changedTitles.length} node(s) it changed is named in it — ${named}`
            : `the subject claims ${tool}, but the diff also changes ${named} — no such call writes those`,
      };
    }
  }

  if (input.committedAt > input.authoredAt) {
    return {
      author: "outside",
      evidence: "rewritten-commit",
      why: `this commit was re-made ${input.committedAt - input.authoredAt}s after it was authored — an amend or a rebase, which no tool in this repository performs`,
    };
  }

  return { author: "tool-surface" };
}

/** Commit metadata, oldest first, over the window asked for. */
async function commitLog(
  g: SimpleGit,
  since: string | undefined,
): Promise<{ sha: string; subject: string; authoredAt: number; committedAt: number }[]> {
  const range = since ? [`${since}..HEAD`] : ["HEAD"];
  // HEAD's history and nothing else. Never `--all` and never `--reflog`: a
  // `git stash` writes commits under `refs/stash` that are NOT in the tree, and a
  // reader that picked them up would report an edit the operator has already
  // taken back — a confident wrong story, which is precisely the failure mode
  // the threshold ranks above a miss.
  const raw = await g.raw(["log", "--reverse", "--format=%H%x1f%at%x1f%ct%x1f%s", ...range]);
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [sha, at, ct, ...rest] = line.split("\x1f");
      return { sha, authoredAt: Number(at), committedAt: Number(ct), subject: rest.join("\x1f") };
    });
}

/** Uncommitted node-file changes sitting in the working tree, in node terms. */
async function workingTreeChanges(g: SimpleGit, vaultDir: string): Promise<NodeChange[]> {
  const status = await g.status();
  const paths = new Set<string>(
    [...status.modified, ...status.created, ...status.deleted, ...status.not_added, ...status.renamed.map((r) => r.to)].filter(
      isNodeFile,
    ),
  );
  const changes: NodeChange[] = [];
  for (const filePath of paths) {
    const before = readSide(await blobAt(g, "HEAD", filePath));
    const abs = path.join(path.resolve(vaultDir), filePath);
    const after = readSide(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
    const change = describeChange(titleOf(filePath), before, after);
    if (change) changes.push(change);
  }
  return foldRenames(changes);
}

/**
 * Every human edit git can account for, oldest first.
 *
 * `since` narrows the history to `since..HEAD` — the sha a pass recorded as
 * `headBefore` when it last ran, which is the natural window for "what changed
 * while I was away". Omitted, the whole of HEAD's history is read, which is what
 * the adversarial run over a real vault wants.
 */
export async function detectHandEdits(vaultDir: string, opts: { since?: string } = {}): Promise<DriftReport> {
  const g = git(vaultDir);
  let commits: Awaited<ReturnType<typeof commitLog>>;
  try {
    commits = await commitLog(g, opts.since);
  } catch (e) {
    return {
      silent: false,
      entries: [],
      commitsRead: 0,
      unreadable: `could not read git history in ${path.resolve(vaultDir)} — ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const entries: DriftEntry[] = [];
  for (const commit of commits) {
    const changed = await changedNodeFiles(g, commit.sha);
    const verdict = classifyCommit({
      subject: commit.subject,
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      changedTitles: changed.map((c) => titleOf(c.path)),
    });
    if (verdict.author === "tool-surface") continue;
    entries.push({
      where: { kind: "commit", sha: commit.sha, subject: commit.subject },
      evidence: verdict.evidence,
      why: verdict.why,
      nodes: await nodeChangesInCommit(g, commit.sha),
    });
  }

  const uncommitted = await workingTreeChanges(g, vaultDir).catch(() => [] as NodeChange[]);
  if (uncommitted.length > 0) {
    entries.push({
      where: { kind: "working-tree" },
      evidence: "uncommitted",
      why: "uncommitted node changes are sitting in the working tree — every write this pass makes stages them under its own name",
      nodes: uncommitted,
    });
  }

  return { silent: entries.length === 0, entries, commitsRead: commits.length };
}

/**
 * The drift report as an operator reads it.
 *
 * Returns lines rather than a string so a caller can choose its stream, and
 * returns an empty array on silence — a pass that found nothing prints nothing,
 * because a report that appears every pass whether or not anything happened is the
 * false alarm this was built to avoid becoming.
 */
export function renderDriftReport(report: DriftReport): string[] {
  if (report.unreadable) return [`drift: unknown — ${report.unreadable}`];
  if (report.silent) return [];
  const lines: string[] = [
    `drift: ${report.entries.length} change(s) to this vault that no call through the tool surface accounts for. ` +
      "Read them before doing anything else — an operator editing by hand is telling you something the tree has no " +
      "other way to hear, and it is evidence, not damage to be tidied away.",
  ];
  for (const entry of report.entries) {
    const where =
      entry.where.kind === "working-tree" ? "working tree (uncommitted)" : `${entry.where.sha.slice(0, 8)} ${entry.where.subject}`;
    lines.push(`  ${where}`);
    lines.push(`    why: ${entry.why}`);
    for (const node of entry.nodes) lines.push(`    ${node.summary}`);
    if (entry.nodes.length === 0) lines.push("    (no node-level change — the commit touched nothing the tree reads)");
  }
  return lines;
}
