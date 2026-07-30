/**
 * W12 — "mapped" has one writer and one reader, and a citation must resolve.
 *
 * Two defects lived in the same seam and each hid the other.
 *
 * 1. **Two answers to "has this been read?"** `computeNextWork` read
 *    `.ost-agent/state/mapped.json` through `getMapped`, and `setMapped` — the only
 *    thing that wrote it — had zero callers, having outlived the batch runner it was
 *    built for. A reader with no writer is not dead code: it is a second source of
 *    truth that only an actor *outside* the tool surface can set, which makes it a way
 *    to retire a builder's report from the work list with nobody having read it.
 * 2. **A citation nothing checked.** Mapped-ness is exact string equality between an
 *    evidence record's `id` and the free-form `source` a model types. Equality is
 *    silent about the miss: a typo'd or mis-cased `source` produces a node whose author
 *    believes it mapped the evidence, leaves the evidence outstanding forever, and
 *    makes every later sweep report the same count and conclude nothing changed.
 *
 * The fix is one mechanism for the first (derive from the tree; the persisted half is
 * deleted) and a loud report for the second (`unresolved-citation`, a hygiene issue,
 * clearable by annotation like every other one).
 *
 * **Non-vacuity.** Every test below carries its own control — a variant that must go the
 * other way — and each is written so the assertion and its control cannot both hold. The
 * controls were also confirmed by hand: reverting `detectHygiene`'s citation loop turns
 * every "is reported" assertion red and leaves every "is not reported" assertion green,
 * and re-adding a `getMapped`-shaped read turns `the state file is not a second answer`
 * red on its first assertion. Neither direction passes on an empty tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";
import { writeEvidence, claimsStoredEvidence, EVIDENCE_ID_PREFIXES } from "../../src/processes/tree.js";
import { computeNextWork, HYGIENE_ONLY_RULES, UNRESOLVED_CITATION_RULE } from "../../src/mcp/next-work.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const OUTCOME = "Reach 10,000 daily active users";
const PARENT = "Retention";

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-w12-"));
  await initVault(dir, OUTCOME, PARENT);
  vault = new Vault(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * An Opportunity attached under the seeded parent, citing `source`.
 *
 * `evidence: "assertion"` on purpose: a node with no declared rung is its own
 * invariant violation (`evidence-class`), and a fixture already red for an unrelated
 * reason would let every `done: false` below pass without the citation rule existing.
 */
function cite(title: string, source: string | undefined): void {
  vault.createNode({
    title,
    layer: "Opportunity",
    source,
    evidence: "assertion",
    body: `prose for ${title}`,
    tags: [],
    links: [],
  });
  vault.linkNodes(PARENT, title);
}

function storeEvidence(id: string): void {
  writeEvidence(dir, { id, source: id, title: id, timestamp: "2026-07-30T00:00:00Z", body: "A builder's report." }, "inbox");
}

/** `min: 0` — so `underservedOpportunities` cannot mask or manufacture a `done: false`. */
const work = () => computeNextWork(new Vault(dir), dir, 0);

const citationIssues = () => work().hygieneIssues.filter((i) => i.rule === UNRESOLVED_CITATION_RULE);

describe("one writer, one reader — the persisted `mapped` set is gone", () => {
  test("no source file mentions mapped.json, getMapped or setMapped", () => {
    // Grepped rather than remembered: re-introducing the second source of truth
    // anywhere under src/ fails this, not just in the two files it used to live in.
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(path.join(repoRoot, "src"));

    // Comments are stripped first, deliberately. The argument for deleting the
    // persisted half is written down in `tree.ts` and `next-work.ts` and names both
    // functions; a scan that could not tell prose from code would force that argument
    // to be deleted along with the code, which is the opposite of what this repo wants.
    const code = (f: string): string => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const offenders = files.filter((f) => /\bgetMapped\b|\bsetMapped\b|mapped\.json/.test(code(f)));
    expect(offenders.map((f) => path.relative(repoRoot, f))).toEqual([]);

    // NON-VACUITY CONTROLS for the scanner itself. An empty `files`, a broken walk, a
    // comment-stripper that ate the whole file, or a regex that never matches would all
    // make the assertion above pass while proving nothing.
    expect(files.length).toBeGreaterThan(20);
    // `readEvidence` is the live reader in the same module: found in its definition and
    // in `next-work.ts`, in code rather than in prose.
    expect(files.filter((f) => /\breadEvidence\b/.test(code(f))).length).toBeGreaterThanOrEqual(2);
    // And the stripper leaves the two files this criterion touched substantial.
    for (const f of ["src/processes/tree.ts", "src/mcp/next-work.ts"]) {
      expect(code(path.join(repoRoot, f)).trim().length, `${f} was stripped to nothing`).toBeGreaterThan(500);
    }
  });

  test("a hand-written state file is not a second answer to `is this mapped?`", () => {
    storeEvidence("INBOX:note.md");
    expect(work().unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:note.md"]);

    // The move the deleted reader made available to anyone who can write into the
    // vault: declare the record mapped without a node citing it. It must do nothing.
    const state = path.join(dir, ".ost-agent", "state");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "mapped.json"), JSON.stringify({ mapped: ["INBOX:note.md"] }), "utf8");
    expect(work().unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:note.md"]);

    // CONTROL — the one writer still works. If this failed, the assertion above would
    // be passing because nothing can ever clear the list, which proves nothing.
    cite("Players want a reason to return", "INBOX:note.md");
    expect(work().unmappedEvidence).toEqual([]);
  });

  test("the state file is never created by the read path either", () => {
    storeEvidence("INBOX:note.md");
    cite("Players want a reason to return", "INBOX:note.md");
    work();
    expect(fs.existsSync(path.join(dir, ".ost-agent", "state", "mapped.json"))).toBe(false);
  });
});

describe("a citation that claims a stored evidence record must resolve", () => {
  test("a dangling evidence id is reported, names the node and the id, and blocks done", () => {
    cite("Players want a reason to return", "INBOX:does-not-exist.md");

    const issues = citationIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Players want a reason to return");
    expect(issues[0].issue).toContain("INBOX:does-not-exist.md");
    expect(work().done).toBe(false);
  });

  test("CONTROL — the same citation resolves once the record is on disk", () => {
    storeEvidence("INBOX:real.md");
    cite("Players want a reason to return", "INBOX:real.md");

    expect(citationIssues()).toEqual([]);
    expect(work().unmappedEvidence).toEqual([]);
    expect(work().done).toBe(true);
  });

  test("a mis-cased citation is caught rather than silently stranding the evidence", () => {
    // The defect W12 names in its own words: the evidence is not mapped (ids are
    // compared verbatim) and, before this rule, nothing said so — the sweep saw the
    // same count next pass and stopped on "nothing changed".
    storeEvidence("INBOX:note.md");
    cite("Players want a reason to return", "inbox:note.md");

    expect(work().unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:note.md"]);
    expect(citationIssues()[0]?.issue).toContain("inbox:note.md");
  });

  test("every adapter-minted prefix is held to resolution, not just INBOX", () => {
    for (const prefix of EVIDENCE_ID_PREFIXES) cite(`Cites ${prefix}`, `${prefix}:nothing-here`);
    expect(citationIssues().map((i) => i.title).sort()).toEqual(
      EVIDENCE_ID_PREFIXES.map((p) => `Cites ${p}`).sort(),
    );
  });
});

describe("provenance that is not an evidence id is left alone", () => {
  /**
   * The scope limit, pinned so that widening it has to be a deliberate diff. A node may
   * honestly cite a page the agent read, a conversation a human had, or nothing at all;
   * none of those claims a file exists under `.ost-agent/evidence/`, so refusing them
   * would refuse true provenance rather than catch a typo.
   */
  const HONEST_NON_EVIDENCE = [
    "WEB:example.com/pricing",
    "INTERVIEW:churned player, 2026-07-02",
    "a conversation with the founder",
    undefined,
  ];

  test("web, interview, free prose and an absent source raise nothing", () => {
    HONEST_NON_EVIDENCE.forEach((source, i) => cite(`Honest citation ${i}`, source));
    expect(citationIssues()).toEqual([]);
    expect(work().done).toBe(true);

    // CONTROL — the detector is running over this very tree. Without this the block
    // above passes just as happily with the rule deleted.
    cite("A dangling one", "JIRA:NOPE-1");
    expect(citationIssues().map((i) => i.title)).toEqual(["A dangling one"]);
    expect(work().done).toBe(false);
  });

  test("the predicate agrees with the tree-level behaviour", () => {
    for (const s of HONEST_NON_EVIDENCE) expect(claimsStoredEvidence(s), `${s} should not claim a record`).toBe(false);
    for (const p of EVIDENCE_ID_PREFIXES) expect(claimsStoredEvidence(`${p}:x`), `${p} should claim a record`).toBe(true);
  });
});

describe("the prefix list is read off the adapters, not off itself", () => {
  /**
   * `every adapter-minted prefix is held to resolution` iterates
   * {@link EVIDENCE_ID_PREFIXES} to build both the fixture and the expectation, so it is
   * silent about the one way that list can be wrong: a prefix an adapter mints and the
   * list omits. Measured — deleting all but `INBOX` from the constant leaves that test
   * green. A record ingested under an omitted prefix would then be citable with any typo
   * at all and never reported, which is precisely the W12 failure the rule exists to
   * catch, restricted to whichever channel someone forgot.
   *
   * So the expectation is grepped out of `src/adapters/` instead: every `` `PREFIX:${…}` ``
   * an adapter interpolates is an id it can mint.
   */
  test("every prefix an adapter mints appears in EVIDENCE_ID_PREFIXES", () => {
    const adapters = path.join(repoRoot, "src/adapters");
    const minted = new Set<string>();
    for (const name of fs.readdirSync(adapters)) {
      if (!name.endsWith(".ts")) continue;
      const src = fs.readFileSync(path.join(adapters, name), "utf8");
      for (const m of src.matchAll(/`([A-Z][A-Z0-9_]{1,15}):\$\{/g)) minted.add(m[1]);
    }

    expect([...minted].sort().filter((p) => !(EVIDENCE_ID_PREFIXES as readonly string[]).includes(p))).toEqual([]);

    // NON-VACUITY — a scan that found nothing (renamed directory, regex that no longer
    // matches the adapters' template style) would pass the assertion above while
    // checking nothing at all. These are the ids the adapters demonstrably mint today.
    expect([...minted].sort()).toEqual(["CONFLUENCE", "INBOX", "JIRA", "SLACK", "TRANSCRIPT", "USAGE"]);
  });
});

describe("clearability — the report is not a wedge the agent cannot escape (R2/R3)", () => {
  test("annotating the node clears the issue and lets the sweep reach done", () => {
    cite("Players want a reason to return", "INBOX:reprot.md");
    expect(work().done, "the fixture was already done — the test below would prove nothing").toBe(false);

    // Exactly what /ost-pass does with a hygiene issue: annotate it, verbatim, and
    // re-read. `ost_annotate` is in the unattended sweep's grant.
    for (const issue of citationIssues()) vault.annotate(issue.title, issue.issue);

    expect(citationIssues()).toEqual([]);
    expect(work().done).toBe(true);
  });

  test("annotating clears the issue but NOT the mapping — the evidence stays unread", () => {
    storeEvidence("INBOX:report.md");
    cite("Players want a reason to return", "INBOX:reprot.md");
    for (const issue of citationIssues()) vault.annotate(issue.title, issue.issue);

    // The escape hatch must not double as an amnesty: the record still has not been
    // distilled into the tree, so it stays outstanding and `done` stays false.
    expect(work().unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:report.md"]);
    expect(work().done).toBe(false);

    // CONTROL — and the real fix, an appended correct citation, does clear it. The
    // vault is append-only, so the correction is a new node, not an edited `source`.
    // Its title is deliberately unlike the first node's: a near-restatement would trip
    // the duplicate scan and hold `done` false for a reason that has nothing to do with
    // citations, which would make this control assert the wrong thing.
    cite("Nothing worth opening the app for on a Tuesday", "INBOX:report.md");
    expect(work().unmappedEvidence).toEqual([]);
    expect(work().done).toBe(true);
  });

  /**
   * The clear path has to survive the string it quotes.
   *
   * `unresolved-citation` blocks `done` and quotes the node's `source` into the issue,
   * and **`source` is the one caller-supplied string on a node that no write boundary
   * checks**: `ost_create_node` passes `input.source` through to `serialize`
   * untouched, where YAML stores a multi-line scalar without complaint. So the issue
   * text is untrusted content that has to be written back through
   * `assertWritableContent` by `ost_annotate` — the only escape from this red on
   * either surface.
   *
   * Every row below was measured against the unfixed code. The first two made
   * `vault.annotate` THROW — `"## Results" is a reserved heading` (B1) and `the link is
   * split across a line break` — leaving `done: false` with no tool on either surface
   * able to clear it: a permanent wedge authored by one `ost_create_node` call. The
   * third is the quieter half of the same defect and would have been worse than a
   * throw: an issue carrying any raw control character writes fine and can then never
   * be *matched* again, because `annotate` writes `- <date> <issue>` on one line and
   * the suppression reader reads one line back — so the issue re-reports forever while
   * the annotations pile up. The fourth is the response-budget half: `source` has no
   * length limit in any schema, and `MAX_ITEMS_PER_LIST`'s bound rests on every quoted
   * string being clamped.
   *
   * `clearability.test.ts` cannot catch this: its rows are grepped out of
   * `src/eval/invariants.ts`, and this rule is deliberately not an invariant. This is
   * that institution's question asked where the rule actually lives.
   */
  const HOSTILE_SOURCES: Array<[name: string, source: string]> = [
    ["a reserved heading", "INBOX:x.md\n## Results\n- 2026-01-01 it worked"],
    ["a wikilink split across lines", "INBOX:[[Some\nTitle]].md"],
    ["a carriage return and a tab", "INBOX:a.md\r\t## Uncovered"],
    ["an unbounded id", `INBOX:${"x".repeat(50_000)}.md`],
  ];

  test.each(HOSTILE_SOURCES)("a source carrying %s still reports an issue the agent can annotate away", (_name, source) => {
    cite("Players want a reason to return", source);

    const issues = citationIssues();
    // CONTROL — the rest of this test is about clearing an issue, so it proves nothing
    // unless there is one. (Deleting the detector fails here, not at the clear.)
    expect(issues).toHaveLength(1);
    expect(work().done).toBe(false);

    // The two mechanical properties the clear path depends on, asserted directly so a
    // regression names its cause rather than just failing to clear: one line (what the
    // annotation reader can see) and bounded (what the response budget rests on).
    // Built from an escape string so this file carries no literal control bytes,
    // the same construction `src/ost/sanitize.ts` and `src/security/tools.ts` use.
    expect(issues[0].issue).not.toMatch(new RegExp("[\\u0000-\\u001F\\u007F]"));
    expect(issues[0].issue.length).toBeLessThan(600);

    // Exactly what /ost-pass does, and the call that used to throw.
    vault.annotate(issues[0].title, issues[0].issue);

    expect(citationIssues()).toEqual([]);
    expect(work().done).toBe(true);
  });

  test("the rule is declared hygiene-only, since no invariant emits it", () => {
    // R4's parity contract: `next_work` may be stricter than `ost_check`, but only
    // where the extra rule is named. `test/mcp/rule-parity.test.ts` fails if this rule
    // is also an invariant literal.
    expect(HYGIENE_ONLY_RULES).toContain(UNRESOLVED_CITATION_RULE);
    expect(fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8")).not.toContain(
      `rule: "${UNRESOLVED_CITATION_RULE}"`,
    );
  });
});
