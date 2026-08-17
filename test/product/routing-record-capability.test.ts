/**
 * Replay the routing record and count how many work classes ever reached more
 * than one collaborator.
 *
 * The candidate's claim is that capability can be estimated from what each
 * collaborator was asked to do and what came back, read off the committed
 * record. The assumption underneath it — the one this file exists to settle —
 * is that the record has enough *variation* to support that: if every work
 * class has exactly one owner, an outcome ledger over it says "the person who
 * does this does this" and dresses a tautology as a profile.
 *
 * So the file is in three parts:
 *
 *   1. **Classifying one artifact**, with the controls that keep the reader
 *      from guessing — every assertion below would pass against a classifier
 *      that named a class for everything, so the cases that return nothing
 *      are the ones carrying the file.
 *   2. **The comparison**, over synthetic records, against the three bands the
 *      assumption test pre-committed: 40% of classes routed to more than one
 *      collaborator to clear, below 25% to kill.
 *   3. **The census over this vault and this repository's own routing
 *      record** — entirely retrospective, against committed state, asking
 *      nothing of an operator and building nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveVaultDir } from "../../src/config/pointer.js";
import type { CommittedArtifact, CommittedRecord } from "../../src/product/capability.js";
import {
  CLEAR_CLASS_SHARE,
  KILL_CLASS_SHARE,
  WORK_CLASSES,
  classifyWorkClass,
  formatRoutingCensus,
  replayRoutingRecord,
  routingRecordCensus,
} from "../../src/product/routing-record.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** An artifact with everything defaulted, so each test states only what it is about. */
function artifact(over: Partial<CommittedArtifact> = {}): CommittedArtifact {
  return {
    kind: "commit",
    ref: "abc1234",
    subject: "feat(adapters): read a Slack channel through an injected client",
    body: "",
    authors: [{ name: "Ada", email: "ada@example.com" }],
    paths: ["src/adapters/slack.ts"],
    commitSubjects: [],
    ...over,
  };
}

describe("classifying one artifact into a work class", () => {
  test("a pull request is review, regardless of what its subject says", () => {
    expect(classifyWorkClass(artifact({ kind: "pr", ref: "#12", subject: "feat: a thing that would otherwise read as build" }))).toBe(
      "review",
    );
  });

  test("a build type names build", () => {
    for (const subject of [
      "feat(adapters): read a Slack channel through an injected client",
      "fix(believability): unlabelled nodes pull the rollup's weakest rung to the floor",
      "perf(git): batch the staged conflict-marker scan so a burst commits fast",
      "refactor: delete the genome and its harness",
    ]) {
      expect(classifyWorkClass(artifact({ subject })), subject).toBe("build");
    }
  });

  test("the build loop's own record in the vault also names build", () => {
    expect(classifyWorkClass(artifact({ subject: "chore(instruments): record 8 observation(s) from the build loop" }))).toBe("build");
  });

  test("a release commit names release", () => {
    expect(classifyWorkClass(artifact({ subject: "release: v0.22.0 — every count states the denominator it was taken over" }))).toBe(
      "release",
    );
  });

  test("the inbox-ingestion tool names discovery pass", () => {
    expect(classifyWorkClass(artifact({ subject: "mcp: ost_ingest_inbox — captured 2 new item(s) from 1 of 8 channel(s)" }))).toBe(
      "discovery pass",
    );
  });

  test("the status tool names decision", () => {
    expect(classifyWorkClass(artifact({ subject: 'mcp: ost_set_status — set "some candidate" to validated' }))).toBe("decision");
  });

  test("CONTROL — an unrelated vault tool call names no class", () => {
    // Without this the census is a tautology: a classifier that always answers
    // makes every artifact comparable and the assumption untestable. These are
    // real, frequent subjects in the vault's own history — ost_annotate and
    // ost_create_node — deliberately left unclassified rather than folded into
    // the nearest bucket.
    for (const subject of [
      'mcp: ost_annotate — annotated "some node" (source: TRANSCRIPT:x)',
      'mcp: ost_create_node — created Solution "some idea" under "some opportunity"',
      'mcp: ost_append_to_node — appended to "some node"',
      "chore: wip",
      "docs: update the README",
      "wip",
    ]) {
      expect(classifyWorkClass(artifact({ subject })), subject).toBeUndefined();
    }
  });

  test("CONTROL — a conventional type outside the build vocabulary names no class", () => {
    expect(classifyWorkClass(artifact({ subject: "test: cover the new branch" }))).toBeUndefined();
    expect(classifyWorkClass(artifact({ subject: "ci: bump the runner image" }))).toBeUndefined();
  });
});

describe("the comparison, over a record the test controls", () => {
  const record = (commits: CommittedArtifact[], prs: CommittedArtifact[] = []): CommittedRecord => ({
    repo: "/x",
    commits,
    prs,
    shallow: false,
  });

  const by = (who: string) => ({ name: who, email: `${who.toLowerCase()}@example.com` });

  test("a class routed to two collaborators is comparable; a class routed to one is not", () => {
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "2", subject: "feat: b", authors: [by("Grace")] }),
        artifact({ ref: "3", subject: "release: v1.0.0", authors: [by("Ada")] }),
      ]),
    ]);
    const build = census.classes.find((c) => c.workClass === "build");
    const release = census.classes.find((c) => c.workClass === "release");
    expect(build?.collaborators).toEqual(["Ada <ada@example.com>", "Grace <grace@example.com>"]);
    expect(release?.collaborators).toEqual(["Ada <ada@example.com>"]);
  });

  test("an unattributable author does not make a class comparable on its own", () => {
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "2", subject: "feat: b", authors: [{ name: "bot", email: "ost-agent@localhost" }] }),
      ]),
    ]);
    expect(census.classes.find((c) => c.workClass === "build")?.collaborators).toEqual(["Ada <ada@example.com>"]);
  });

  test("a co-author counts as a second collaborator", () => {
    const census = replayRoutingRecord([
      record([artifact({ ref: "1", subject: "feat: a", authors: [by("Ada"), by("Grace")] })]),
    ]);
    expect(census.classes.find((c) => c.workClass === "build")?.collaborators).toHaveLength(2);
  });

  test("clear — at least 40% of classes routed to more than one collaborator", () => {
    // build and release are comparable (two collaborators each); decision is
    // not (one). 2 of 3 examined classes = 67%.
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "2", subject: "feat: b", authors: [by("Grace")] }),
        artifact({ ref: "3", subject: "release: v1.0.0", authors: [by("Ada")] }),
        artifact({ ref: "4", subject: "release: v1.0.1", authors: [by("Grace")] }),
        artifact({ ref: "5", subject: 'mcp: ost_set_status — set "x" to validated', authors: [by("Ada")] }),
      ]),
    ]);
    expect(census.examined).toBe(3);
    expect(census.comparable).toBe(2);
    expect(census.share).toBeCloseTo(2 / 3);
    expect(census.verdict).toBe("clear");
  });

  test("25% exactly lands in the middle band — the kill line is 'below 25%', not 'at or below'", () => {
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "2", subject: "feat: b", authors: [by("Grace")] }),
        artifact({ ref: "3", subject: "release: v1.0.0", authors: [by("Ada")] }),
        artifact({ ref: "4", subject: 'mcp: ost_set_status — set "x" to validated', authors: [by("Ada")] }),
        artifact({ ref: "5", subject: "mcp: ost_ingest_inbox — captured 1 new item(s)", authors: [by("Ada")] }),
      ]),
    ]);
    expect(census.examined).toBe(4);
    expect(census.comparable).toBe(1);
    expect(census.share).toBe(0.25);
    expect(census.verdict).toBe("narrowed");
  });

  test("refuted — strictly below the 25% kill line", () => {
    // Every class here is single-owner: no class is comparable at all.
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "3", subject: "release: v1.0.0", authors: [by("Ada")] }),
        artifact({ ref: "4", subject: 'mcp: ost_set_status — set "x" to validated', authors: [by("Ada")] }),
        artifact({ ref: "5", subject: "mcp: ost_ingest_inbox — captured 1 new item(s)", authors: [by("Ada")] }),
        artifact({ ref: "6", subject: "chore(instruments): record 1 observation(s) from the build loop", authors: [by("Ada")] }),
      ]),
    ]);
    expect(census.comparable).toBe(0);
    expect(census.share).toBeLessThan(KILL_CLASS_SHARE);
    expect(census.verdict).toBe("refuted");
  });

  test("narrowed — between the kill line and the clear line", () => {
    // 1 of 3 = 33%: above kill (25%), below clear (40%).
    const census = replayRoutingRecord([
      record([
        artifact({ ref: "1", subject: "feat: a", authors: [by("Ada")] }),
        artifact({ ref: "2", subject: "feat: b", authors: [by("Grace")] }),
        artifact({ ref: "3", subject: "release: v1.0.0", authors: [by("Ada")] }),
        artifact({ ref: "4", subject: 'mcp: ost_set_status — set "x" to validated', authors: [by("Ada")] }),
      ]),
    ]);
    expect(census.examined).toBe(3);
    expect(census.share).toBeCloseTo(1 / 3);
    expect(census.share).toBeGreaterThanOrEqual(KILL_CLASS_SHARE);
    expect(census.share).toBeLessThan(CLEAR_CLASS_SHARE);
    expect(census.verdict).toBe("narrowed");
  });

  test("a work class never routed at all is absent from the count, not counted against it", () => {
    const census = replayRoutingRecord([record([artifact({ subject: "feat: a" })])]);
    expect(census.examined).toBe(1);
    expect(census.classes.map((c) => c.workClass)).toEqual(["build"]);
  });

  test("the formatter names every class examined and every class never reached", () => {
    const census = replayRoutingRecord([
      record([artifact({ subject: "feat: a" }), artifact({ ref: "2", subject: "release: v1.0.0" })]),
    ]);
    const rendered = formatRoutingCensus(census);
    expect(rendered).toContain("build:");
    expect(rendered).toContain("release:");
    expect(rendered).toMatch(/never routed at all:.*review.*discovery pass.*decision/);
  });
});

/**
 * The census the assumption test asked for, over the routing record this
 * vault and this repository have actually written — entirely retrospective,
 * no operator asked for anything, nothing built to produce the subject.
 *
 * The pre-commitment, made before anything had been counted: at least 40% of
 * distinct work classes must have been routed to more than one collaborator
 * for the estimate to stand on the whole record; below 25% kills the
 * candidate outright, because at that concentration the profile cannot
 * correct itself — the self-confirming failure the solution names as its
 * chief risk.
 */
const VAULT = resolveVaultDir(undefined, { cwd: REPO_ROOT });

describe("the census over this vault and this repository's own routing record", () => {
  // `ost.vault.yaml`'s pointer (`vault: ../../ost-agent-meta`) is the maintainer's own
  // layout, committed so their local `ost-agent status` finds the right tree — it is not
  // a claim that every environment running this suite has that sibling checked out. CI
  // does not, and `readWholeCommittedRecord` throws "Cannot use simple-git on a directory
  // that does not exist" for it — a "this repository always has that sibling" assumption
  // this test made silently, not a defect in the census it exists to prove. Skipping
  // (reported, not silently green) is honest about what could not be checked here; running
  // it wherever the vault genuinely is checked out — the maintainer's machine, or a CI job
  // that clones both — still proves the real claim.
  test.skipIf(!fs.existsSync(VAULT.dir))(
    "the routing record supports a capability estimate, and the count is the honest limit on it",
    async () => {
      const census = await routingRecordCensus([REPO_ROOT, VAULT.dir]);

      // Report before asserting: a number the reader can see is the point of the census.
      console.log(formatRoutingCensus(census));

      expect(census.examined, "no work class was ever routed at all — nothing to compare").toBeGreaterThan(0);
      expect(census.share, `${census.comparable}/${census.examined} work class(es) comparable`).toBeGreaterThanOrEqual(
        KILL_CLASS_SHARE,
      );
      expect(census.verdict).not.toBe("refuted");

      for (const c of census.classes) {
        expect(WORK_CLASSES).toContain(c.workClass);
        expect(c.artifacts).toBeGreaterThan(0);
      }
    },
  );
});
