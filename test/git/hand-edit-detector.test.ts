import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit, type SimpleGit } from "simple-git";
import { classifyCommit, detectHandEdits, renderDriftReport } from "../../src/git/hand-edit-detector.js";

/**
 * "Can a pass tell a human edit from its own, using only git" — the assumption
 * test this solution's build permit rests on, and the one it can settle.
 *
 * The assumption is **feasibility**: that human edits are cleanly separable from
 * tool-driven ones using only what git already records — no new state, no file
 * watching, no daemon. It looks trivially true from the incident that inspired it
 * (the tool commits everything it writes; the human's edit sat uncommitted in the
 * working tree) and the test is whether that holds up outside that one case.
 *
 * The pre-committed threshold, from the node, in the order it ranks them:
 *
 *   1. **Zero false positives on clean history.** A drift report that cries wolf
 *      is worse than none — the operator learns to skip it and then misses the
 *      real one.
 *   2. **False negatives are acceptable** provided they fail toward *silence*
 *      rather than toward a confident wrong story about what the human meant.
 *   3. **The report names nodes and links, not files.** "the Outcome's link
 *      target is now empty and a new node carries its 8 links" is actionable;
 *      "2 files changed" is not.
 *
 * The adversarial cases are the node's own list, one `describe` each: a hand edit
 * committed with an `mcp:`-style subject, a frontmatter-only edit, a rename that
 * rewrites inbound links, a `git stash`, a branch switch, an amended commit, and a
 * clean-history control.
 *
 * Two of them exist to pin a *refusal to report* rather than a report, and they
 * are the ones worth reading first: the stash and the branch switch are where a
 * naive detector manufactures drift out of git plumbing rather than out of
 * anything a human did to the tree.
 */

let dir: string;
let g: SimpleGit;
let defaultBranch: string;

/** Fixed epoch seconds, advanced by hand — no `Date.now()` anywhere in this file. */
let clock = 1_760_000_000;

/**
 * A minimal environment for the git calls that have to be handed one.
 *
 * Built from nothing rather than spread from `process.env`, because simple-git's
 * `block-unsafe-operations` plugin refuses any call whose supplied env carries
 * `EDITOR` or `GIT_EDITOR` — and the agent harness these tests run under exports
 * both. Spreading the ambient environment therefore fails every git command on
 * that machine and passes on one where those happen to be unset, which is a test
 * whose result depends on who is running it.
 */
function gitEnv(extra: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, ...extra };
}

function at(seconds = clock): SimpleGit {
  return simpleGit(dir).env(
    gitEnv({ GIT_AUTHOR_DATE: `${seconds} +0000`, GIT_COMMITTER_DATE: `${seconds} +0000` }),
  );
}

/** A node file exactly as the vault writes one: frontmatter, tag line, wikilink lines, prose. */
function nodeFile(type: string, links: readonly string[], body: string): string {
  return `---\ntype: ${type}\nstatus: unvalidated\n---\n#${type}\n${links.map((l) => `[[${l}]]`).join("\n")}\n\n${body}\n`;
}

function write(title: string, content: string): void {
  fs.writeFileSync(path.join(dir, `${title}.md`), content, "utf8");
}

function read(title: string): string {
  return fs.readFileSync(path.join(dir, `${title}.md`), "utf8");
}

/**
 * One commit, at a fixed date. Deliberately two git invocations and not three —
 * the suite this joins already carries wall-clock bars measured against its own
 * ambient load (`test/telemetry/same-run-baseline-ratio.test.ts`, and the D1
 * entry in `docs/reference/v1-readiness.md` on why), and a fixture that seeds six
 * commits per test is a subprocess budget worth spending carefully. Nothing here
 * needs the resulting sha.
 */
async function commit(subject: string, opts: { committedAt?: number } = {}): Promise<void> {
  clock += 60;
  const client = simpleGit(dir).env(
    gitEnv({ GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${opts.committedAt ?? clock} +0000` }),
  );
  await client.add(["-A"]);
  await client.commit(subject);
}

/**
 * The vault as the tool surface builds it: one node per commit, each subject in
 * the `mcp: <tool> — <text>` form `src/mcp/server.ts` writes, naming exactly the
 * nodes that call touched.
 *
 *   Outcome ─┬─ Umbrella ─┬─ Child A
 *            │            └─ Child B
 *            └─ Sibling
 */
async function seedCleanVault(): Promise<void> {
  write("Outcome", nodeFile("Outcome", [], "Ship a thing people want."));
  await commit('mcp: ost_create_node — created Outcome "Outcome"');
  defaultBranch = (await simpleGit(dir).revparse(["--abbrev-ref", "HEAD"])).trim();

  write("Umbrella", nodeFile("Opportunity", [], "The operator cannot walk away."));
  write("Outcome", nodeFile("Outcome", ["Umbrella"], "Ship a thing people want."));
  await commit('mcp: ost_create_node — created Opportunity "Umbrella" under "Outcome"');

  write("Child A", nodeFile("Solution", [], "One way to do it."));
  write("Umbrella", nodeFile("Opportunity", ["Child A"], "The operator cannot walk away."));
  await commit('mcp: ost_create_node — created Solution "Child A" under "Umbrella"');

  write("Child B", nodeFile("Solution", [], "Another way to do it."));
  write("Umbrella", nodeFile("Opportunity", ["Child A", "Child B"], "The operator cannot walk away."));
  await commit('mcp: ost_create_node — created Solution "Child B" under "Umbrella"');

  write("Sibling", nodeFile("Opportunity", [], "A different need."));
  write("Outcome", nodeFile("Outcome", ["Umbrella", "Sibling"], "Ship a thing people want."));
  await commit('mcp: ost_create_node — created Opportunity "Sibling" under "Outcome"');

  write("Child A", nodeFile("Solution", [], "One way to do it.\n\n## History\n- reconsidered"));
  await commit('mcp: ost_append_to_node — appended to "Child A"');
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-hand-edit-"));
  g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "ost-agent@localhost");
  await g.addConfig("user.name", "OST-Agent");
  await g.addConfig("commit.gpgsign", "false");
  await seedCleanVault();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Every node title the report named, across every entry. */
function titlesReported(entries: { nodes: { title: string; renamedTo?: string }[] }[]): string[] {
  return entries.flatMap((e) => e.nodes.flatMap((n) => (n.renamedTo ? [n.title, n.renamedTo] : [n.title])));
}

describe("clean history draws silence — the threshold that ranks above every detection here", () => {
  test("a vault only the tool surface ever wrote reports nothing", async () => {
    const report = await detectHandEdits(dir);

    expect(report.silent).toBe(true);
    expect(report.entries).toEqual([]);
    // Six commits were read and six were cleared. Silence because it looked and
    // found nothing, not because it never looked.
    expect(report.commitsRead).toBe(6);
  });

  test("silence prints nothing at all — a report that appears every pass is the false alarm", async () => {
    expect(renderDriftReport(await detectHandEdits(dir))).toEqual([]);
  });

  test("the build loop's own instrument commits are not human edits, though they rewrite node files", async () => {
    write("Child A", `${read("Child A")}\n## Instrument Log\n- 2026-08-04 **red** (exit 1) \`npx vitest run x\`\n`);
    await commit("chore(instruments): record 1 observation(s) from the build loop");

    expect((await detectHandEdits(dir)).silent).toBe(true);
  });
});

describe("the incident itself: an edit that never reached a commit", () => {
  test("an uncommitted hand edit is reported before the pass writes over it", async () => {
    write("Child A", nodeFile("Solution", ["Invented child"], "One way to do it."));

    const report = await detectHandEdits(dir);

    expect(report.silent).toBe(false);
    const entry = report.entries.find((e) => e.where.kind === "working-tree");
    expect(entry?.evidence).toBe("uncommitted");
    expect(entry?.nodes[0].linksAdded).toEqual(["Invented child"]);
  });
});

describe("a hand edit committed with an `mcp:`-style subject", () => {
  test("a plausible subject copied onto somebody else's edit is caught by the diff, not believed", async () => {
    write("Child B", nodeFile("Solution", [], "Another way to do it.\n\nActually I think this is the one."));
    await commit('mcp: ost_append_to_node — appended to "Child A"');

    const report = await detectHandEdits(dir);

    expect(report.silent).toBe(false);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].evidence).toBe("uncorroborated-diff");
    expect(report.entries[0].why).toContain("Child B");
    expect(titlesReported(report.entries)).toEqual(["Child B"]);
  });

  test("a subject naming a node the commit never touched is caught the same way", async () => {
    write("Sibling", nodeFile("Opportunity", [], "A different need, restated by hand."));
    await commit('mcp: ost_set_status — status of "Child A" set to validated');

    const report = await detectHandEdits(dir);

    expect(report.entries[0].evidence).toBe("uncorroborated-diff");
    expect(report.entries[0].why).toContain("Sibling");
  });

  test("a tool whose footprint can exceed its subject is not accused of exceeding it", async () => {
    // `ost_merge_nodes` repoints every inbound link to the node it retires and
    // names only two titles, so the corroboration rule must not apply to it. This
    // is the shape of false positive the threshold ranks first, and it is
    // excluded by construction rather than by tuning.
    write("Outcome", nodeFile("Outcome", ["Umbrella"], "Ship a thing people want."));
    fs.rmSync(path.join(dir, "Sibling.md"));
    write("Umbrella", nodeFile("Opportunity", ["Child A", "Child B"], "The operator cannot walk away.\n\nmerged in Sibling."));
    await commit('mcp: ost_merge_nodes — merged "Sibling" into "Umbrella" and deleted its file');

    expect((await detectHandEdits(dir)).silent).toBe(true);
  });

  test("THE BOUNDARY: a careful forgery is invisible, and fails toward silence rather than a wrong story", async () => {
    // The person edits "Child A" and commits it under the exact subject the agent
    // would have written for that same node. Every byte git records about this
    // commit is identical to the agent commit it imitates, so no reader of git
    // can separate them — and the honest behaviour is to say nothing rather than
    // to guess. Closing this needs a signature over the commit, which is new
    // state and a different assumption from the one under test here.
    write("Child A", nodeFile("Solution", [], "One way to do it.\n\nI disagree with this framing."));
    await commit('mcp: ost_append_to_node — appended to "Child A"');

    const report = await detectHandEdits(dir);

    expect(report.silent).toBe(true);
    expect(report.entries).toEqual([]);
  });
});

describe("a frontmatter-only edit", () => {
  test("a `type:` the schema has no word for is reported as the node going invisible, with its links counted", async () => {
    // The 2026-07-24 incident, exactly: an operator reached for a node type the
    // schema does not have. `readTree` stops returning the node and its edges
    // vanish with it — and nothing failed.
    write("Umbrella", read("Umbrella").replace("type: Opportunity", "type: Metric"));
    await commit("retype the umbrella to what it actually is");

    const report = await detectHandEdits(dir);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].evidence).toBe("unexplained-subject");
    const change = report.entries[0].nodes[0];
    expect(change.title).toBe("Umbrella");
    expect(change.becameInvisible).toBe(true);
    expect(change.summary).toContain("type: Opportunity → Metric");
    // The point of the report: not "1 file changed", but which edges stopped
    // existing as far as every reader of the tree is concerned.
    expect(change.summary).toContain("2 link(s) are invisible");
  });

  test("a frontmatter edit that keeps a known type is reported as the field it moved, not as invisibility", async () => {
    write("Child A", read("Child A").replace("status: unvalidated", "status: validated"));
    await commit("mark child A validated");

    const change = (await detectHandEdits(dir)).entries[0].nodes[0];

    expect(change.becameInvisible).toBe(false);
    expect(change.fieldsChanged).toEqual(["status: unvalidated → validated"]);
  });
});

describe("a rename that rewrites inbound links, leaving no empty file behind", () => {
  test("the two halves are folded into one rename, named by the link set they share", async () => {
    // Obsidian's own rename path: the old file is deleted rather than emptied, the
    // new one is written, and every inbound wikilink is rewritten in the same
    // commit. `rename-topology.ts` looks for the *emptied* variant; this is the
    // one it cannot see, and title distance would find nothing here — the new
    // title shares no words with the old.
    const goal = "Any steakholder can pour compute into it and trust the map";
    fs.rmSync(path.join(dir, "Umbrella.md"));
    write(goal, nodeFile("Opportunity", ["Child A", "Child B"], "The operator cannot walk away."));
    write("Outcome", nodeFile("Outcome", [goal, "Sibling"], "Ship a thing people want."));
    await commit("rename the umbrella");

    const report = await detectHandEdits(dir);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].nodes).toHaveLength(1);
    const change = report.entries[0].nodes[0];
    expect(change.kind).toBe("renamed");
    expect(change.title).toBe("Umbrella");
    expect(change.renamedTo).toBe(goal);
    expect(change.summary).toContain("same 2 outgoing link(s)");
    expect(change.summary).toContain('inbound link(s) were repointed with it (from "Outcome")');
  });

  test("a rename that leaves its inbound links behind says so, because that is what dangles", async () => {
    const goal = "Any steakholder can pour compute into it and trust the map";
    fs.rmSync(path.join(dir, "Umbrella.md"));
    write(goal, nodeFile("Opportunity", ["Child A", "Child B"], "The operator cannot walk away."));
    await commit("rename the umbrella, forget the Outcome");

    const change = (await detectHandEdits(dir)).entries[0].nodes[0];

    expect(change.kind).toBe("renamed");
    expect(change.summary).toContain("no inbound link was repointed");
  });
});

describe("a `git stash`", () => {
  test("stashing a hand edit restores silence, and the stashed commits are never reported", async () => {
    // A stash writes real commits under `refs/stash` that are NOT in the tree. A
    // reader that walked `--all` or `--reflog` would report an edit the operator
    // has already taken back — a confident wrong story, which the threshold ranks
    // as worse than a miss.
    write("Child A", nodeFile("Solution", ["Invented child"], "One way to do it."));
    expect((await detectHandEdits(dir)).silent).toBe(false);

    await at().raw(["stash", "push", "-u", "-m", "wip"]);

    const report = await detectHandEdits(dir);
    expect(report.silent).toBe(true);
    expect(report.commitsRead).toBe(6);
  });

  test("popping the stash brings the edit back into view", async () => {
    write("Child A", nodeFile("Solution", ["Invented child"], "One way to do it."));
    await at().raw(["stash", "push", "-u", "-m", "wip"]);
    await at().raw(["stash", "pop"]);

    expect((await detectHandEdits(dir)).silent).toBe(false);
  });
});

describe("a branch switch", () => {
  test("commits that are not reachable from HEAD are not drift, however they were written", async () => {
    await at().checkoutLocalBranch("hand-edits");
    write("Child B", nodeFile("Solution", [], "Another way to do it.\n\nrewritten by hand"));
    await commit("my own take on child B");
    expect((await detectHandEdits(dir)).silent).toBe(false);

    await at().checkout(defaultBranch);

    // Nothing about the vault the pass is standing in has drifted. A detector
    // that diffed "the vault now" against "the last state the pass wrote" would
    // report the whole branch difference here; reading HEAD's history instead
    // makes a branch switch cost nothing.
    const report = await detectHandEdits(dir);
    expect(report.silent).toBe(true);
    expect(report.commitsRead).toBe(6);
  });

  test("switching TO the branch that carries the edit brings it into view", async () => {
    await at().checkoutLocalBranch("hand-edits");
    write("Child B", nodeFile("Solution", [], "Another way to do it.\n\nrewritten by hand"));
    await commit("my own take on child B");
    await at().checkout(defaultBranch);
    await at().checkout("hand-edits");

    const report = await detectHandEdits(dir);
    expect(report.silent).toBe(false);
    expect(titlesReported(report.entries)).toEqual(["Child B"]);
  });
});

describe("an amended commit", () => {
  test("an agent commit a human amended is caught by the node it gained, and named as a rewrite", async () => {
    write("Sibling", nodeFile("Opportunity", [], "A different need, and here is what I really meant."));
    // `--amend` folds the hand edit into the agent's last commit and keeps its
    // subject. The committer timestamp moves; the author timestamp does not.
    await at(clock + 3600).raw(["add", "-A"]);
    await at(clock + 3600).raw(["commit", "--amend", "--no-edit"]);

    const report = await detectHandEdits(dir);

    expect(report.entries).toHaveLength(1);
    // Two signals agree here. The diff one is the load-bearing half: the subject
    // claims an append to "Child A" and the commit now also carries "Sibling".
    expect(report.entries[0].evidence).toBe("uncorroborated-diff");
    expect(titlesReported(report.entries)).toContain("Sibling");
  });

  test("an amend that leaves the diff corroborating is still caught, by the rewrite alone", async () => {
    // Nothing about the diff contradicts the subject — only the fact that the
    // commit was re-made an hour after it was authored, which no writer in this
    // repository does.
    write("Child A", nodeFile("Solution", [], "One way to do it.\n\n## History\n- reconsidered, then reconsidered again"));
    await at(clock + 3600).raw(["add", "-A"]);
    await at(clock + 3600).raw(["commit", "--amend", "--no-edit"]);

    const report = await detectHandEdits(dir);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].evidence).toBe("rewritten-commit");
    expect(report.entries[0].why).toContain("3600s after it was authored");
  });
});

describe("the report is in node and link terms, not file terms", () => {
  test("no line of a rendered report names a file", async () => {
    write("Umbrella", read("Umbrella").replace("type: Opportunity", "type: Metric"));
    await commit("retype the umbrella");
    write("Child A", nodeFile("Solution", ["Invented child"], "One way to do it."));

    const lines = renderDriftReport(await detectHandEdits(dir));

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(".md");
    expect(lines.join("\n")).toContain('"Umbrella"');
    expect(lines.join("\n")).toContain("[[Invented child]]");
  });

  test("an unreadable history is reported as unknown, never as silence", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ost-not-a-repo-"));
    try {
      const report = await detectHandEdits(empty);
      expect(report.silent).toBe(false);
      expect(report.unreadable).toBeTruthy();
      expect(renderDriftReport(report)[0]).toContain("drift: unknown");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("the classifier on its own, with no repository in the way", () => {
  test("a commit touching no node file is silent whatever its subject says", () => {
    expect(classifyCommit({ subject: "ost: the fortieth pass", authoredAt: 1, committedAt: 1, changedTitles: [] })).toEqual({
      author: "tool-surface",
    });
  });

  test("a merge subject is machine-written even though nobody in this repo issues it", () => {
    expect(
      classifyCommit({ subject: "Merge branch 'main'", authoredAt: 1, committedAt: 1, changedTitles: ["Child A"] }),
    ).toEqual({ author: "tool-surface" });
  });

  test("a node whose TITLE contains quotes does not read as an uncorroborated diff", () => {
    // Found by running this detector over the vault's own 3,675 commits, where it
    // was the one genuine false positive. Splitting the subject on `"` to recover
    // the titles it claims yields `The harness can reliably tell `, ` apart from `
    // and ` under ` — none of which is a node — so the commit that created this
    // node accused the tool surface of writing something it had not. Produced
    // entirely by punctuation in a title, against the threshold that ranks
    // false positives first.
    const title = "The harness can reliably tell created by this session apart from pre-existing, this session just wrote to it";
    expect(
      classifyCommit({
        subject:
          'mcp: ost_create_node — created Assumption "The harness can reliably tell "created by this session" apart from ' +
          '"pre-existing, this session just wrote to it"" under "Skip the read-before-write guard for files the session itself just created"',
        authoredAt: 1,
        committedAt: 1,
        changedTitles: [title, "Skip the read-before-write guard for files the session itself just created"],
      }),
    ).toEqual({ author: "tool-surface" });
  });

  test("titles are matched the way the vault stores them, so a colon in a subject does not manufacture drift", () => {
    // `sanitizeTitle` turns `:` into a space, so the node lives at `Unknown what
    // we cannot see.md` while the subject quotes what the caller typed. Comparing
    // those raw would make every such commit look uncorroborated.
    expect(
      classifyCommit({
        subject: 'mcp: ost_annotate — annotated "Unknown: what we cannot see"',
        authoredAt: 1,
        committedAt: 1,
        changedTitles: ["Unknown what we cannot see"],
      }),
    ).toEqual({ author: "tool-surface" });
  });
});
