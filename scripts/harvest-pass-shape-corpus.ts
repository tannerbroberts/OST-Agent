/**
 * Cut the pass-shape corpus out of a vault's own git history.
 *
 * Run by hand, output committed under `test/fixtures/pass-shape/`. It exists so
 * the labels `test/loop/pass-shape-classifier.test.ts` measures agreement against
 * are a rule anyone can re-run and disagree with, rather than a set of opinions
 * somebody typed — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-pass-shape-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/pass-shape
 *
 * **The labels are cut from the diff; the classifier only ever sees the subject.**
 * That split is the whole point of the corpus and the reason the agreement number
 * means anything. The assumption under test ("Structure and commentary are
 * separable from the shape of the output alone") is a claim that the *cheap*
 * signal — what a commit says it did — reproduces the *expensive* one — what the
 * commit actually did to the tree. If the labels were also read off the subject,
 * agreement would be 100% and would measure nothing. So this script reads every
 * commit twice, through two deliberately unequal windows:
 *
 * - **the subject**, kept verbatim (capped at {@link SUBJECT_CAP} characters,
 *   which every `mcp:` subject's tool name and node title fit inside), and
 * - **the diff**, reduced to the seven counts in {@link CommitFacts} — the
 *   mechanical reading of the assumption test's own definition of the two
 *   classes, "structure = new nodes/links/status; commentary = annotations/appends
 *   only".
 *
 * The label is not stored as an opinion either: it is `structure` iff at least one
 * structural count is non-zero, recomputed from the committed facts by
 * {@link labelFromFacts}, which the test re-runs on load. A human who thinks
 * `instrument:` is not a status field can flip one predicate and re-measure
 * without re-harvesting, and PROVENANCE.md records what that flip does to the
 * number.
 *
 * Nothing here is imported by src/. The fixture is the artefact.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * How much of a commit subject is kept.
 *
 * The `ost_ingest_inbox` subjects run to a kilobyte — a per-channel report folded
 * into the subject line — and carry no signal past the tool name. 240 characters
 * holds every `mcp:` tool name and the full node title after it, which is what a
 * human auditing a row needs to see to check its label by eye.
 */
const SUBJECT_CAP = 240;

/**
 * Frontmatter fields grouped by what changing one means for the tree.
 *
 * The split exists so the sensitivity of the label to the arguable calls can be
 * measured rather than argued about. `type`/`status`/`done` are the assumption
 * test's own word ("status") and are not in dispute. `instrument` and `evidence`
 * are the calls a re-cut might reasonably reverse: an instrument is what makes a
 * test runnable and an evidence rung is what makes a node believable, so both
 * change what the tree *claims* without adding a node — structural on this
 * reading, commentary on a stricter one.
 */
const STATUS_FIELDS = ["type", "status", "done"];
const INSTRUMENT_FIELDS = ["instrument"];
const EVIDENCE_FIELDS = ["evidence", "source"];

/**
 * How far into a file a `+`/`-` line can be and still count as frontmatter.
 *
 * Node frontmatter in this vault runs from line 1 to at most line 10 (`---`,
 * six-or-so fields, `---`). Twelve leaves slack for a wrapped `source:` block
 * without reaching the body, where a line beginning `source:` would be prose.
 */
const FRONTMATTER_LINES = 12;

/** The diff-side reading of one commit. Every field is a count of changed lines. */
export interface CommitFacts {
  /** Node files created by this commit. */
  nodesAdded: number;
  /** Node files deleted by this commit. */
  nodesRemoved: number;
  /** Node files renamed by this commit — a retitle is a link change everywhere. */
  nodesRenamed: number;
  /**
   * Bare wikilink lines added or removed in a node body.
   *
   * *Bare* — a line whose entire trimmed content is `[[Title]]`, which is how this
   * vault writes a parent link and a "Proving this" backlink. A wikilink inside a
   * sentence is a reference, not an edge, and counting those was worth 40 spurious
   * `structure` labels on the first cut of this corpus: the vault contains 199
   * commits whose appended prose includes the literal text "not a `[[wikilink]]`",
   * every one of which a looser rule read as a new link.
   */
  linksChanged: number;
  /** `type:`/`status:`/`done:` frontmatter lines changed. */
  statusChanged: number;
  /** `instrument:` frontmatter lines changed. */
  instrumentChanged: number;
  /** `evidence:`/`source:` frontmatter lines changed. */
  evidenceChanged: number;
  /** Body lines added to an existing node that were none of the above. */
  proseAdded: number;
  /** Distinct node files touched. */
  nodeFiles: number;
  /** Distinct non-node files touched (`.ost-agent/`, `.claude/`, and so on). */
  otherFiles: number;
}

export interface CommitRow extends CommitFacts {
  sha: string;
  subject: string;
  /** Author date, ISO 8601. Present so passes can be cut out of the corpus by gap. */
  at: string;
  /** True for a git merge commit — it has more than one parent. */
  merge: boolean;
}

/**
 * The assumption test's definition of the two classes, applied to the counts.
 *
 * "structure = new nodes/links/status; commentary = annotations/appends only" —
 * so anything that moved a node, an edge or a declared field is structure, and a
 * commit that only added prose (or only touched files that are not nodes at all)
 * is commentary. Exported because the test recomputes it rather than trusting a
 * stored string.
 */
export function labelFromFacts(f: CommitFacts): "structure" | "commentary" {
  const structural =
    f.nodesAdded +
    f.nodesRemoved +
    f.nodesRenamed +
    f.linksChanged +
    f.statusChanged +
    f.instrumentChanged +
    f.evidenceChanged;
  return structural > 0 ? "structure" : "commentary";
}

/** A vault node is a markdown file at the vault root. Everything else is not. */
function isNodeFile(p: string): boolean {
  return /^[^/]+\.md$/.test(p) && p !== "README.md";
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    maxBuffer: 1 << 30,
    encoding: "utf8",
  });
}

/** Read one commit's diff into counts. `body` is `git show --unified=0` output. */
function factsFromDiff(body: string): CommitFacts {
  const f: CommitFacts = {
    nodesAdded: 0,
    nodesRemoved: 0,
    nodesRenamed: 0,
    linksChanged: 0,
    statusChanged: 0,
    instrumentChanged: 0,
    evidenceChanged: 0,
    proseAdded: 0,
    nodeFiles: 0,
    otherFiles: 0,
  };
  const nodeFiles = new Set<string>();
  const otherFiles = new Set<string>();
  let inNode = false;
  let inFrontmatter = false;

  for (const line of body.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      const file = m ? m[2] : undefined;
      inNode = file !== undefined && isNodeFile(file);
      if (file !== undefined) (inNode ? nodeFiles : otherFiles).add(file);
      inFrontmatter = false;
      continue;
    }
    if (line.startsWith("new file mode") && inNode) f.nodesAdded++;
    else if (line.startsWith("deleted file mode") && inNode) f.nodesRemoved++;
    else if (line.startsWith("rename to ") && isNodeFile(line.slice("rename to ".length))) {
      f.nodesRenamed++;
    }
    if (!inNode) continue;
    if (line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      inFrontmatter = m !== null && Number(m[1]) <= FRONTMATTER_LINES;
      continue;
    }
    if (line[0] !== "+" && line[0] !== "-") continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;

    const text = line.slice(1).trim();
    if (/^\[\[[^\]]+\]\]$/.test(text)) {
      f.linksChanged++;
      continue;
    }
    if (inFrontmatter) {
      const field = /^([a-z]+):/.exec(text)?.[1];
      if (field !== undefined && STATUS_FIELDS.includes(field)) {
        f.statusChanged++;
        continue;
      }
      if (field !== undefined && INSTRUMENT_FIELDS.includes(field)) {
        f.instrumentChanged++;
        continue;
      }
      if (field !== undefined && EVIDENCE_FIELDS.includes(field)) {
        f.evidenceChanged++;
        continue;
      }
    }
    if (line[0] === "+") f.proseAdded++;
  }

  f.nodeFiles = nodeFiles.size;
  f.otherFiles = otherFiles.size;
  return f;
}

function main(): void {
  const [vault, outDir] = process.argv.slice(2);
  if (vault === undefined || outDir === undefined) {
    console.error(
      "usage: npx tsx scripts/harvest-pass-shape-corpus.ts <vault> <out-dir>",
    );
    process.exit(2);
  }

  const head = git(vault, ["rev-parse", "HEAD"]).trim();
  const shas = git(vault, ["log", "--pretty=%H", "--reverse"]).trim().split("\n");
  console.error(`${shas.length} commits, HEAD ${head.slice(0, 10)}`);

  const rows: CommitRow[] = [];
  for (const sha of shas) {
    const raw = git(vault, [
      "show",
      sha,
      "--no-color",
      "--find-renames",
      "--first-parent",
      "--unified=0",
      "--pretty=format:%s%x00%P%x00%aI%x00",
    ]);
    const [subject = "", parents = "", at = "", body = ""] = raw.split("\0");
    rows.push({
      sha: sha.slice(0, 12),
      subject: subject.replace(/\s+/g, " ").slice(0, SUBJECT_CAP),
      at,
      merge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      ...factsFromDiff(body),
    });
  }

  fs.mkdirSync(outDir, { recursive: true });
  // One row per line: a 3000-row corpus is unreadable pretty-printed and twice the
  // size minified, and a line-per-commit diff is what makes a re-cut reviewable.
  const body = rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n");
  const header = JSON.stringify(
    { vault: path.basename(vault), head, commits: rows.length, subjectCap: SUBJECT_CAP },
    null,
    1,
  ).replace(/\n\}$/, "");
  const out = path.join(outDir, "commits.json");
  fs.writeFileSync(out, `${header},\n "rows": [\n${body}\n ]\n}\n`);

  const structure = rows.filter((r) => labelFromFacts(r) === "structure").length;
  console.error(
    `wrote ${out}: ${structure} structure, ${rows.length - structure} commentary`,
  );
}

main();
