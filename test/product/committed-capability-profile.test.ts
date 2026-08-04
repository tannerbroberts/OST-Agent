/**
 * The committed capability profile, and the census that says whether it is
 * worth reading.
 *
 * The candidate's claim is that a picture of what a collaborator can do is
 * already lying in the repository, so nobody has to deposit anything. The
 * assumption underneath it — the one this file exists to settle — is that the
 * record is *legible*: "already there" and "specific enough for a reader to name
 * a capability" are different properties, and a history of `wip` and `update
 * stuff` satisfies the first while saying nothing.
 *
 * So the file is in three parts, and the order matters:
 *
 *   1. **The reading rule, with its controls.** Every assertion below would pass
 *      against an extractor that named a capability for everything, so the
 *      controls that force it to return nothing are the ones carrying the file.
 *   2. **No deposit.** A scratch repository with no config, no vault, no
 *      environment and no operator still profiles — which is the mechanism's
 *      whole argument.
 *   3. **The census over this repository's own record**, against the bands that
 *      were written down before anyone counted: 70 of 100 commits and 20 of 30
 *      pull requests to stand on the whole record, below 50 of 100 to kill the
 *      candidate outright.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  builderKey,
  coAuthorsOf,
  committedCapabilityProfile,
  domainFromPaths,
  domainFromScope,
  formatCapabilityProfile,
  legibilityOf,
  nameCapability,
  profileCommittedRecord,
  CLEAR_COMMIT_SHARE,
  CLEAR_PR_SHARE,
  KILL_COMMIT_SHARE,
  type CommittedArtifact,
} from "../../src/product/capability.js";

/** This repository — the subject of part 3, and the record the assumption is about. */
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

describe("naming a capability off one artifact", () => {
  test("a conventional subject names a kind of work and the domain from its scope", () => {
    const named = nameCapability(artifact());
    expect(named).toEqual({ verb: "builds", domain: "adapters", label: "builds adapters" });
  });

  test("with no scope, the domain comes from what the diff touched", () => {
    const named = nameCapability(
      artifact({ subject: "fix: stop the walk dropping a file it could not parse", paths: ["src/ost/census.ts", "src/ost/node.ts"] }),
    );
    expect(named?.domain).toBe("ost");
    expect(named?.verb).toBe("diagnoses and repairs");
  });

  test("a merge commit is legible when the work it merged is, and not otherwise", () => {
    const empty = artifact({ kind: "pr", subject: "Merge pull request #37 from owner/a-branch", body: "", paths: [] });
    expect(nameCapability(empty)).toBeUndefined();
    const carried = { ...empty, commitSubjects: ["fix(build-loop): stop asserting the loop works without checking"] };
    expect(nameCapability(carried)?.label).toBe("diagnoses and repairs build-loop");
  });

  test("CONTROL — a well-formed message with nothing in it names no capability", () => {
    // Without these the census is a tautology: an extractor that always answers
    // makes every record 100% legible and the assumption untestable.
    for (const subject of ["wip", "chore: wip", "fix: typo", "docs: update", "feat(adapters): more", "chore(ci): bump"]) {
      expect(nameCapability(artifact({ subject })), subject).toBeUndefined();
    }
  });

  test("CONTROL — a type outside the vocabulary, and a subject with no type at all", () => {
    expect(nameCapability(artifact({ subject: "Merge remote-tracking branch 'origin/main' into topic" }))).toBeUndefined();
    expect(nameCapability(artifact({ subject: "shipped: the new onboarding flow for everyone" }))).toBeUndefined();
  });

  test("CONTROL — a real subject with no locatable domain names nothing", () => {
    // A diff spread over more areas than any one dominates, and a scope that is a
    // work-item id rather than an area, both leave the reader with a verb and no object.
    const spread = artifact({ subject: "refactor: delete the genome and its harness", paths: ["src/a/x.ts", "src/b/y.ts", "src/c/z.ts", "docs/d.md"] });
    expect(nameCapability(spread)).toBeUndefined();
    expect(nameCapability(artifact({ subject: "feat(w11): stamp who produced an evidence record", paths: [] }))).toBeUndefined();
  });

  test("an opaque scope falls through to the diff rather than becoming the domain", () => {
    // "builds w11" is a sentence nobody can act on. The tag is discarded, and the
    // paths get their turn — which is the only reason this one is legible at all.
    const named = nameCapability(artifact({ subject: "feat(tier2): take three forgeable instruments off the surface", paths: ["src/security/tools.ts", "src/security/policy.ts"] }));
    expect(named?.domain).toBe("security");
  });

  test("scope words and scope tags, one line each", () => {
    for (const word of ["vault", "ost", "gate-b", "build-loop", "w11,evidence"]) {
      expect(domainFromScope(word), word).toBeTruthy();
    }
    for (const tag of ["w11", "b4", "p3", "f6", "tier2", "w2,w3", "g1"]) {
      expect(domainFromScope(tag), tag).toBeUndefined();
    }
  });

  test("a domain from paths needs the area to dominate, not merely to lead", () => {
    expect(domainFromPaths(["src/web/a.ts", "src/web/b.ts", "src/ost/c.ts"])).toBe("web");
    expect(domainFromPaths(["src/web/a.ts", "src/ost/b.ts", "src/eval/c.ts"])).toBeUndefined();
    expect(domainFromPaths([])).toBeUndefined();
    expect(domainFromPaths(["README.md"])).toBeUndefined();
  });
});

describe("who the record attributes work to", () => {
  test("a co-author trailer is a builder, because the author field records who ran the tool", () => {
    // Read at the reader, so an artifact reaching the profile already carries
    // everyone it is attributed to. In this repository the author field is
    // routinely the party that ran the tool rather than the party that did the
    // work, and the trailer is the only place the second one appears.
    expect(coAuthorsOf("Why this shape.\n\nCo-authored-by: Claude Opus 5 <noreply@anthropic.com>\n")).toEqual([
      { name: "Claude Opus 5", email: "noreply@anthropic.com" },
    ]);
    expect(coAuthorsOf("no trailer here")).toEqual([]);

    const a = artifact({ authors: [{ name: "Ada", email: "ada@example.com" }, { name: "Claude", email: "noreply@anthropic.com" }] });
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: [a], prs: [] });
    expect(report.builders.map((b) => b.name)).toEqual(["Ada", "Claude"]);
    for (const b of report.builders) expect(b.capabilities[0].label).toBe("builds adapters");
  });

  test("a machine identity is not a builder the profile will name", () => {
    const bot = artifact({ authors: [{ name: "OST-Agent", email: "ost-agent@localhost" }] });
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: [bot], prs: [] });
    expect(report.builders).toEqual([]);
    expect(legibilityOf("commit", [bot])).toMatchObject({ examined: 1, attributed: 0, legible: 0 });
  });

  test("an illegible artifact still counts against the builder it is attributed to", () => {
    // The blind spot has to be visible in the profile, not silently dropped: a
    // builder whose messages say nothing must read as unread, not as unskilled.
    const report = profileCommittedRecord({
      repo: "/x",
      commits: [artifact(), artifact({ ref: "def5678", subject: "wip" })],
      prs: [],
    });
    expect(report.builders[0]).toMatchObject({ attributed: 2, legible: 1 });
  });

  test("evidence is capped but never empty, so any claim can be checked", () => {
    const many = Array.from({ length: 9 }, (_, i) => artifact({ ref: `sha${i}` }));
    const [profile] = profileCommittedRecord({ shallow: false, repo: "/x", commits: many, prs: [] }).builders;
    expect(profile.capabilities[0].count).toBe(9);
    expect(profile.capabilities[0].refs).toEqual(["sha0", "sha1", "sha2", "sha3", "sha4"]);
    expect(builderKey({ name: "Ada", email: "ada@example.com" })).toBe("Ada <ada@example.com>");
  });
});

describe("the three bands, and what each one makes the profile say", () => {
  const legible = (n: number) => Array.from({ length: n }, (_, i) => artifact({ ref: `ok${i}` }));
  const mute = (n: number) => Array.from({ length: n }, (_, i) => artifact({ ref: `no${i}`, subject: "wip" }));

  test("dense enough to stand on the whole record", () => {
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: [...legible(80), ...mute(20)], prs: legible(30) });
    expect(report.verdict).toBe("clear");
    expect(report.coverage).toContain("80 of 100");
  });

  test("the middle band ships, and says on its face what it did not cover", () => {
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: [...legible(60), ...mute(40)], prs: legible(30) });
    expect(report.verdict).toBe("narrowed");
    expect(report.coverage).toMatch(/Narrowed/);
    expect(report.coverage).toMatch(/not covered/);
  });

  test("below half, the profile refuses to be read as a finding", () => {
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: [...legible(40), ...mute(60)], prs: legible(30) });
    expect(report.verdict).toBe("refuted");
    expect(report.coverage).toMatch(/reading noise/);
  });

  test("legible commits with an illegible PR half do not read as clear", () => {
    const report = profileCommittedRecord({ shallow: false, repo: "/x", commits: legible(100), prs: [...legible(10), ...mute(20)] });
    expect(report.verdict).toBe("narrowed");
  });

  test("a shallow clone is unread, and says so ahead of any verdict", () => {
    // Found by shipping it: CI checks out at depth 1, and the census read a
    // record of one commit and reported a share of it. Every count here is a
    // share of a denominator, and a denominator the reader could not see makes
    // any share look decisive — so this is said before the band is, rather than
    // being turned into a skip.
    const truncated = profileCommittedRecord({ shallow: true, repo: "/x", commits: legible(1), prs: [] });
    expect(truncated.shallow).toBe(true);
    expect(truncated.coverage).toMatch(/^Unread:/);
    expect(truncated.coverage).toMatch(/unshallow|fetch-depth/);
    expect(formatCapabilityProfile(truncated)).toContain("UNREAD (shallow clone)");

    // CONTROL — the same reading over a full clone reports its band as usual.
    const full = profileCommittedRecord({ shallow: false, repo: "/x", commits: legible(1), prs: [] });
    expect(full.coverage).not.toMatch(/^Unread:/);
    expect(formatCapabilityProfile(full)).not.toContain("UNREAD");
  });
});

/**
 * No deposit — the mechanism's whole argument, run against a repository that has
 * never heard of this product.
 *
 * Nothing is configured, no vault exists, no environment variable is read, and
 * no party is asked for anything. If a profile comes back, the claim "the
 * artifacts are already there" holds for a git repository as such.
 */
describe("no deposit is asked for", () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ost-capability-"));
    const g = simpleGit(scratch);
    await g.init();
    await g.addConfig("user.name", "Grace");
    await g.addConfig("user.email", "grace@example.com");
    const commit = async (file: string, subject: string, body = "") => {
      fs.mkdirSync(path.join(scratch, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(scratch, file), `// ${subject}\n`);
      await g.add(["-A"]);
      await g.commit(body ? `${subject}\n\n${body}` : subject);
    };
    await commit("src/billing/invoice.ts", "feat(billing): issue an invoice the customer can dispute");
    await commit("src/billing/tax.ts", "fix(billing): stop rounding tax the wrong way at the boundary");
    await commit("src/notify/email.ts", "feat: send the receipt from the address the customer replies to", "Co-authored-by: Alan <alan@example.com>");
    await commit("src/notify/sms.ts", "wip");
  });

  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  test("a bare git repository yields a profile, with nothing supplied but its path", async () => {
    const report = await committedCapabilityProfile(scratch);
    expect(report.commits.examined).toBe(4);
    expect(report.commits.attributed).toBe(4);
    expect(report.commits.legible).toBe(3);

    const grace = report.builders.find((b) => b.name === "Grace");
    expect(grace?.capabilities.map((c) => c.label).sort()).toEqual([
      "builds notify",
      "diagnoses and repairs billing",
      // "builds billing" — the first commit; sorted alphabetically with the rest.
      "builds billing",
    ].sort());

    // The co-author is a builder here on the strength of one trailer, and no more.
    const alan = report.builders.find((b) => b.name === "Alan");
    expect(alan?.attributed).toBe(1);
    expect(alan?.capabilities.map((c) => c.label)).toEqual(["builds notify"]);

    // A repository with no pull requests reports none rather than inventing them.
    expect(report.prs.examined).toBe(0);
    expect(report.verdict).not.toBe("refuted");
  });

  test("a directory that is not a repository is refused, not silently profiled as empty", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ost-not-a-repo-"));
    try {
      await expect(committedCapabilityProfile(bare)).rejects.toThrow(/not a git repository/i);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

/**
 * The census the assumption test asked for, over this repository's own record.
 *
 * The pre-commitment, made before anything had been counted: at least 70 of the
 * last 100 commits and 20 of the last 30 pull requests must carry both an
 * identifiable author and enough specificity to name one capability, for the
 * profile to stand on the whole record. Below 50 of 100 kills the candidate —
 * at that density the archaeology is reading noise and no later engineering
 * recovers signal that was never written down.
 *
 * These assertions run against a moving history, and that is intended rather
 * than tolerated: the thing being asserted is a property of the record, so a
 * record that degrades below the kill line SHOULD turn this red. What is fixed
 * is the bar, which was fixed before the first reading.
 *
 * The census needs the record present to read it, and the first run in CI did
 * not have one — `actions/checkout` clones at depth 1, so a census over the last
 * 100 commits saw one. The fix is `fetch-depth: 0` in `.github/workflows/ci.yml`
 * plus the assertion below, deliberately in that order: making the subject
 * available is the fix, and the assertion is what stops the next environment
 * that hides it from reading as a pass.
 */
describe("the census over this repository's committed record", () => {
  test("the record is legible enough for a capability profile to be derived at all", async () => {
    const report = await committedCapabilityProfile(REPO_ROOT, { commits: 100, prs: 30 });

    // Report before asserting: a number the reader can see is the point of the census.
    console.log(formatCapabilityProfile(report).split("\n").slice(0, 3).join("\n"));

    // The subject, before the reading of it. A census whose denominator is
    // whatever history the environment happened to fetch is not this census.
    expect(
      report.shallow,
      "the clone is shallow — this census has no record to read. Set `fetch-depth: 0` on actions/checkout, or `git fetch --unshallow` locally.",
    ).toBe(false);
    expect(report.commits.examined, "fewer than 100 commits reachable from HEAD").toBe(100);
    expect(report.prs.examined, "fewer than 30 pull requests reachable from HEAD").toBe(30);

    // The kill line. Nothing below it ships in any form.
    const commitShare = report.commits.legible / report.commits.examined;
    const prShare = report.prs.legible / report.prs.examined;
    expect(report.verdict, `${report.commits.legible}/100 commits, ${report.prs.legible}/30 PRs`).not.toBe("refuted");
    expect(commitShare).toBeGreaterThanOrEqual(KILL_COMMIT_SHARE);

    // And whichever of the two surviving bands it landed in, the profile has to
    // say which — a narrowed reading that presents itself as a whole one is the
    // failure this census was taken to prevent.
    if (commitShare >= CLEAR_COMMIT_SHARE && prShare >= CLEAR_PR_SHARE) {
      expect(report.verdict).toBe("clear");
    } else {
      expect(report.verdict).toBe("narrowed");
      expect(report.coverage).toMatch(/^Narrowed:/);
      expect(report.coverage).toContain(`${report.commits.legible} of ${report.commits.examined} commit(s)`);
    }
  });

  test("the profile names builders, with checkable evidence under each capability", async () => {
    const report = await committedCapabilityProfile(REPO_ROOT, { commits: 100, prs: 30 });
    expect(report.builders.length).toBeGreaterThan(0);

    for (const b of report.builders) {
      expect(b.legible).toBeLessThanOrEqual(b.attributed);
      for (const c of b.capabilities) {
        expect(c.refs.length).toBeGreaterThan(0);
        expect(c.refs.length).toBeLessThanOrEqual(c.count);
        expect(c.label).toBe(`${c.verb} ${c.domain}`);
      }
    }

    // The rendered profile carries its own coverage and its own limits, so a
    // reader who sees only this output cannot mistake it for a whole reading.
    const rendered = formatCapabilityProfile(report);
    expect(rendered).toContain(report.coverage);
    expect(rendered).toMatch(/capability EXERCISED/);
    expect(rendered).toMatch(/Nothing was asked of anyone/);
  });
});
