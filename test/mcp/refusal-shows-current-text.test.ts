import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MIN_SIMILARITY,
  renderIntendedSite,
  textAtIntendedSite,
} from "../../src/fs/current-text.js";
import { DriftError, readWithHash, writeWithHash } from "../../src/git/read-write-hash-guard.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * "Check whether the near-miss text would have supplied the correction" — the
 * assumption test beneath "Make the refusal show the text that is actually
 * there now", and the build permit this file discharges.
 *
 * Its threshold, verbatim: *"In at least 4 of the 6 captured Edit failures, the
 * text at the intended site contains everything needed to compose a correct
 * retry."* Its method: *"For each, recover the file state at that moment from
 * git history, extract what the proposed message would have shown, and judge
 * whether an agent holding that message could have composed a correct retry
 * without re-reading the file."*
 *
 * ## What the evidence actually supports, and where the method runs out
 *
 * The six records are `TRANSCRIPT_*.md` files in this vault's evidence folder,
 * written by the transcript adapter. They are **one-line summaries**: the tool
 * that failed, and roughly sixty characters of the error, ellipsised. They do
 * not carry the `old_string`, the file path, or a timestamp — the same gap the
 * opportunity node states in its own words ("separating those requires the
 * read/write timestamps the transcripts do not carry"), and the same gap
 * `test/git/read-write-hash-drift.test.ts` works around for the sibling
 * candidate.
 *
 * So the "recover from git history" half is possible for **two of the six**,
 * and those two are recovered here for real — the truncated snippet in each
 * record happens to be the TAIL of the failing `old_string`, which is enough to
 * find the file and the commit:
 *
 *   - `4ff7b605` — `… (!blocksDone || allOpenUnknowns.length === 0);`. That line
 *     is `src/mcp/next-work.ts:264` at `8261a6f^`, and the session's own day
 *     (2026-07-29) is the day `8261a6f` ("delete the genome") removed the
 *     `blocksDone` clause. QUOTED and CURRENT below are `git show` output from
 *     those two commits, unedited.
 *   - `424486ec` — ``… > `src/knowledge/web-trust.ts:62`)``. That citation is
 *     `docs/reference/v1-readiness.md:987` at `21ef1a1^`, and `21ef1a1` (same
 *     day, 2026-07-30) rewrote the paragraph around it. This is also the one
 *     session whose own clarifying question names a concurrent writer, so it is
 *     the drift case of the six.
 *
 * For `995b8ab1` and `5960b7ec` the record carries no content at all — only the
 * harness's own diagnostic, which IS load-bearing and is quoted in the fixture:
 * *"Edit also tried swapping \uXXXX escapes and their characters; neither form
 * matched, so the mismatch is likely elsewhere in old_string."* That sentence
 * fixes the shape of the failure precisely — a quote carrying a `\uXXXX` escape
 * against a file holding the character, PLUS a second difference elsewhere —
 * and the fixture is built to that shape out of real lines from this
 * repository. Label real, content reconstructed, and said out loud rather than
 * left for a reader to discover.
 *
 * `0d27cebf` and `516fdfb8` are scored as misses, and neither is scored that
 * way to make a number: `0d27cebf`'s snippet is `… });`, which names no site in
 * any file, and `516fdfb8` is `No changes to make: old_string and new_string
 * are exactly the same` — a no-op edit, where the text at the site is exactly
 * what was quoted and showing it adds nothing the refusal did not already say.
 *
 * ## How "could have composed a correct retry" is decided
 *
 * Mechanically, not by reading. A record supplies the correction when the
 * message the mechanism produces contains, verbatim, a string that (a) is
 * present in the current file and (b) carries the part the caller demonstrably
 * did NOT have — the token its quote got wrong. Feeding that string back as the
 * new `old_string` must find a match. A judgement made by `String.includes` is
 * one a later reader can re-run.
 */

/** The bar the assumption test pre-committed, before any of this was measured. */
const THRESHOLD = 4;

interface Recorded {
  session: string;
  /** How the fixture below relates to what the transcript actually captured. */
  provenance: "recovered-from-git" | "reconstructed-to-the-recorded-diagnostic" | "not-replayable";
  /** The file as it stood when the edit was attempted. Empty when not replayable. */
  current: string;
  /** The `old_string` the session presented. Empty when not replayable. */
  quoted: string;
  /**
   * The part of the current text the caller provably did not hold — the thing
   * that makes a shown site a correction rather than a restatement. A record
   * supplies the correction only if the message carries this.
   */
  needs: string;
  why: string;
}

/* ------------------------------------------------------------------ *
 * 4ff7b605 — `src/mcp/next-work.ts`, real, from 8261a6f^ and 8261a6f *
 * ------------------------------------------------------------------ */

/** `git show '8261a6f^:src/mcp/next-work.ts' | sed -n '253,275p'`, unedited. */
const NEXT_WORK_BEFORE = `  // silently shortened the list would read as "that is all the darkness there is".
  const cap = genome.pivot.maxOpenUnknownsSurfaced;
  const openUnknowns = cap > 0 ? allOpenUnknowns.slice(0, cap) : allOpenUnknowns;
  const hidden = allOpenUnknowns.length - openUnknowns.length;
  const blocksDone = genome.pivot.unknownsBlockDone;

  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0 &&
    (!blocksDone || allOpenUnknowns.length === 0);

  const parts: string[] = [];
`;

/** `git show '8261a6f:src/mcp/next-work.ts' | sed -n '170,190p'`, unedited. */
const NEXT_WORK_AFTER = `
  // The cap is a display limit, never an amnesty: \`done\` is computed over every
  // open unknown, and the hidden count is named in the summary. A cap that
  // silently shortened the list would read as "that is all the darkness there is".
  const cap = MAX_OPEN_UNKNOWNS_SURFACED;
  const openUnknowns = cap > 0 ? allOpenUnknowns.slice(0, cap) : allOpenUnknowns;
  const hidden = allOpenUnknowns.length - openUnknowns.length;

  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0;

  const parts: string[] = [];
  if (unmappedEvidence.length) parts.push(\`\${unmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes\`);
  if (allOpenUnknowns.length)
    parts.push(\`\${allOpenUnknowns.length} open unknown(s) → explore (does not block done)\`);
`;

/** The block the session quoted: the `done` computation as it read at `8261a6f^`. */
const NEXT_WORK_QUOTED = `  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0 &&
    (!blocksDone || allOpenUnknowns.length === 0);`;

/* -------------------------------------------------------------------------- *
 * 424486ec — `docs/reference/v1-readiness.md`, real, from 21ef1a1^ and 21ef1a1 *
 * -------------------------------------------------------------------------- */

/** `git show '21ef1a1^:docs/reference/v1-readiness.md' | sed -n '983,993p'`, unedited. */
const READINESS_QUOTED = `> **The rule was already written down twice, in prose, addressed to the model.**
> \`ost_rank_source\`'s description and \`web-trust.ts\` both say
> \`observed\`/\`money\` "can only be earned by first-party measurement
> (AssumptionTests + \`ost_set_evidence\`), never by a byline"
> (\`src/security/tools.ts:504\`, \`src/knowledge/web-trust.ts:62\`) — in the two`;

/** `git show '21ef1a1:docs/reference/v1-readiness.md' | sed -n '1048,1062p'`, unedited. */
const READINESS_AFTER = `> than only reddening \`check\` — the R4 defect this document was built to stop
> re-introducing.
>
> **The rule was already written down twice, in prose, addressed to the model.**
> When this closed, \`ost_rank_source\`'s description and \`web-trust.ts\` both said
> \`observed\`/\`money\` "can only be earned by first-party measurement
> (AssumptionTests + \`ost_set_evidence\`), never by a byline" — in the two places
> where the model is the actor being constrained. Both are now *data* rather than
> prose: B5 and B6 turned the second into \`TRUST_CEILINGS\`
> (\`src/knowledge/actor-trust.ts:110\`), whose table says the same thing in a form the
> scorer reads, and the tool description that remains
> (\`src/security/tools.ts:966\`) describes that table instead of asking the model to
> honour it. This criterion computes it on the node side: a
> measurement rung has to point at a measurement, which is either a recorded
> result (the node's own \`## Results\`, or one on a node it links to) or provenance
`;

/* --------------------------------------------------------------------- *
 * 995b8ab1 / 5960b7ec — the two escape-swap records, built to their own  *
 * diagnostic out of real lines from this repository.                     *
 * --------------------------------------------------------------------- */

const ESCAPE_FILE_A = `  const parts: string[] = [];
  if (unmappedEvidence.length) parts.push(\`\${unmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes\`);
  if (hygieneIssues.length) parts.push(\`\${hygieneIssues.length} hygiene issue(s) → annotate (never delete)\`);
`;

/** `\\u2192` written out where the file holds `→`, AND `annotate (never delete)` mis-remembered — the recorded shape. */
const ESCAPE_QUOTED_A =
  "  if (hygieneIssues.length) parts.push(`${hygieneIssues.length} hygiene issue(s) \\u2192 annotate, never delete`);";

const ESCAPE_FILE_B = `/**
 * Rungs on the believability ladder — assertion → stated → expert → observed → money.
 *
 * A measurement rung has to point at a measurement.
 */
`;

const ESCAPE_QUOTED_B =
  " * Rungs on the believability ladder \\u2014 assertion \\u2192 stated \\u2192 expert \\u2192 observed \\u2192 cash.";

/** The `516fdfb8` no-op: the caller quoted exactly what the file holds. */
const NO_OP_FILE = `export const VERSION = "0.9.1";\n`;

const RECORDS: readonly Recorded[] = [
  {
    session: "4ff7b605-da1d-4f2e-8c05-ec6408118837",
    provenance: "recovered-from-git",
    current: NEXT_WORK_AFTER,
    quoted: NEXT_WORK_QUOTED,
    // The caller's quote ended `hygieneIssues.length === 0 &&` + the blocksDone
    // clause. What it could not know without re-reading is that the clause is
    // gone and the conjunction now terminates on `hygieneIssues`.
    needs: "hygieneIssues.length === 0;",
    why: "the genome deletion removed the `blocksDone` clause between the read and the edit",
  },
  {
    session: "424486ec-3489-4b53-8e2b-012232d221ab",
    provenance: "recovered-from-git",
    current: READINESS_AFTER,
    quoted: READINESS_QUOTED,
    // The concurrent writer dropped the two file:line citations and reflowed
    // the sentence. `in the two places` is the reflow the caller did not have.
    needs: 'never by a byline" — in the two places',
    why: "a concurrent writer rewrote the paragraph; this is the session that named the second writer out loud",
  },
  {
    session: "995b8ab1-5e55-4a5c-b05d-aaed9e1d7538",
    provenance: "reconstructed-to-the-recorded-diagnostic",
    current: ESCAPE_FILE_A,
    quoted: ESCAPE_QUOTED_A,
    needs: "annotate (never delete)",
    why: "the harness reported swapping \\uXXXX escapes did not match, so the mismatch was elsewhere in old_string",
  },
  {
    session: "5960b7ec-960c-4700-9e0b-2b68c3519e92",
    provenance: "reconstructed-to-the-recorded-diagnostic",
    current: ESCAPE_FILE_B,
    quoted: ESCAPE_QUOTED_B,
    needs: "observed → money",
    why: "same recorded diagnostic; the escape swap was tried and the real difference was a word",
  },
  {
    session: "0d27cebf-9b5d-4cff-906c-0134512573bc",
    provenance: "not-replayable",
    current: "",
    quoted: "",
    needs: "",
    why: "the record's whole snippet is `… });` — it names neither a file nor enough of the quote to locate a site",
  },
  {
    session: "516fdfb8-bab1-41a4-b1e5-92fde97bd90d",
    provenance: "not-replayable",
    current: NO_OP_FILE,
    quoted: 'export const VERSION = "0.9.1";',
    needs: "",
    why: "`No changes to make: old_string and new_string are exactly the same` — a no-op, not a failed match",
  },
];

/**
 * Would the message have supplied the correction?
 *
 * True only when the mechanism named a site, the text it shows is genuinely in
 * the file (so a retry quoting it matches), and that text carries the part the
 * caller did not hold. All three are checked, because the first two alone are
 * satisfied by echoing any line of the file back.
 */
function suppliesCorrection(record: Recorded): { supplied: boolean; message: string } {
  if (record.provenance === "not-replayable" && record.current === "") {
    return { supplied: false, message: "(no content in the record to replay)" };
  }
  const lookup = textAtIntendedSite(record.current, record.quoted);
  const message = renderIntendedSite(lookup, `session-${record.session}`);
  if (lookup.kind !== "site") return { supplied: false, message };
  const retryQuote = lookup.site.text;
  const supplied =
    record.current.includes(retryQuote) && retryQuote.includes(record.needs) && record.needs !== "";
  return { supplied, message };
}

describe("the mechanism — a failed match answers with the text that is there", () => {
  test("a whitespace-only miss shows the line as it is actually indented", () => {
    // Quoted with more indentation than the file carries — the direction that
    // is a genuine miss, since a literal editor matches substrings and would
    // have found a quote that was merely shorter.
    const file = "function f() {\n      return 1;\n}\n";
    const lookup = textAtIntendedSite(file, "            return 1;");
    expect(lookup.kind).toBe("site");
    if (lookup.kind !== "site") return;
    expect(lookup.site.differs).toBe("whitespace");
    expect(lookup.site.text).toBe("      return 1;");
    expect(file).toContain(lookup.site.text);
  });

  test("a `\\uXXXX` escape quoted against the character itself is named as such", () => {
    const file = "const arrow = \"→ next\";\n";
    const lookup = textAtIntendedSite(file, 'const arrow = "\\u2192 next";');
    expect(lookup.kind).toBe("site");
    if (lookup.kind !== "site") return;
    expect(lookup.site.differs).toBe("escape");
    expect(lookup.site.text).toContain("→ next");
  });

  test("the shown text is verbatim — it is the retry's quote, not a summary of one", () => {
    const file = "alpha\nbravo CHANGED\ncharlie\ndelta\n";
    const lookup = textAtIntendedSite(file, "alpha\nbravo\ncharlie");
    expect(lookup.kind).toBe("site");
    if (lookup.kind !== "site") return;
    expect(file).toContain(lookup.site.text);
    expect(lookup.site.text).toBe("alpha\nbravo CHANGED\ncharlie");
    // The retry composed from it finds a match, which is the whole claim.
    expect(file.indexOf(lookup.site.text)).toBeGreaterThanOrEqual(0);
  });

  test("context is carried so the caller can re-anchor without re-reading", () => {
    const file = ["l1", "l2", "l3", "target CHANGED;", "l5", "l6", "l7"].join("\n");
    const lookup = textAtIntendedSite(file, "target;");
    expect(lookup.kind).toBe("site");
    if (lookup.kind !== "site") return;
    expect(lookup.site.line).toBe(4);
    expect(lookup.site.withContext).toContain("l1");
    expect(lookup.site.withContext).toContain("l7");
  });

  test("a target that is genuinely gone comes back vanished, not as the least-bad window", () => {
    // The candidate's own stated limit: "If the old text is gone entirely,
    // there is no near-miss to show and this returns nothing useful." A
    // mechanism that always names a site would score 6/6 on the replay below
    // and be worse than the refusal it replaces.
    const file = "import fs from 'node:fs';\nexport const answer = 42;\n";
    const lookup = textAtIntendedSite(file, "class TotallyUnrelatedThing extends Base {\n  handle() {}\n}");
    expect(lookup.kind).toBe("vanished");
    if (lookup.kind !== "vanished") return;
    expect(lookup.vanished.bestSimilarity).toBeLessThan(MIN_SIMILARITY);
    expect(renderIntendedSite(lookup, "f.ts")).toContain("nothing at any site");
  });

  test("declining is said out loud, so a caller can tell a refusal from nobody having looked", () => {
    const rendered = renderIntendedSite(
      textAtIntendedSite("a\nb\nc\n", "zzzzzzzzzz\nyyyyyyyyyy\nxxxxxxxxxx"),
      "f.ts",
    );
    expect(rendered).toMatch(/below the \d+% bar/);
    expect(rendered).toContain("nothing here to re-quote");
  });

  test("a quote that does match is reported as present rather than dressed up as a near-miss", () => {
    const lookup = textAtIntendedSite("alpha\nbravo\n", "bravo");
    expect(lookup.kind).toBe("matched");
    expect(renderIntendedSite(lookup, "f.ts")).toContain("IS present");
  });

  test("the excerpt is bounded — a refusal must not cost more than the call it explains", () => {
    const file = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const quoted = Array.from({ length: 200 }, (_, i) => `line ${i} DRIFTED`).join("\n");
    const lookup = textAtIntendedSite(file, quoted);
    if (lookup.kind !== "site") return;
    expect(lookup.site.text.split("\n").length).toBeLessThanOrEqual(20);
    expect(lookup.site.truncated).toBe(true);
  });
});

describe("replaying the six captured Edit failures", () => {
  test(`the shown text supplies the correction in at least ${THRESHOLD} of 6`, () => {
    const scored = RECORDS.map((r) => ({ ...r, ...suppliesCorrection(r) }));
    const supplied = scored.filter((s) => s.supplied);

    const ledger = scored
      .map((s) => `${s.supplied ? "SUPPLIED" : "  missed"}  ${s.session}  (${s.provenance}) — ${s.why}`)
      .join("\n");

    expect(RECORDS).toHaveLength(6);
    expect(supplied.length, `\n${ledger}\n`).toBeGreaterThanOrEqual(THRESHOLD);
  });

  test("both git-recovered records supply it — those are the two with real content behind them", () => {
    // The reconstructed pair could be argued with; these two cannot. If the
    // claim only held on reconstructed fixtures it would be worth very little.
    for (const record of RECORDS.filter((r) => r.provenance === "recovered-from-git")) {
      const { supplied, message } = suppliesCorrection(record);
      expect(supplied, `${record.session}\n${message}`).toBe(true);
    }
  });

  test("the drift record and the bad-quote records are both served, so this candidate is not drift-only", () => {
    // `424486ec` is the one session whose transcript names a concurrent writer;
    // the rest are ordinary literal misses. The candidate claims to help with
    // both, and that is the difference between it and its hash-guard sibling.
    const drift = RECORDS.find((r) => r.session.startsWith("424486ec"))!;
    const notDrift = RECORDS.find((r) => r.session.startsWith("4ff7b605"))!;
    expect(suppliesCorrection(drift).supplied).toBe(true);
    expect(suppliesCorrection(notDrift).supplied).toBe(true);
  });

  test("the misses are recorded as misses rather than quietly dropped from the denominator", () => {
    const missed = RECORDS.map((r) => ({ r, ...suppliesCorrection(r) })).filter((s) => !s.supplied);
    // The assumption test pre-committed that two would miss and predicted the
    // reason: "the two failures whose cause was a genuinely vanished target".
    // Both misses here are something else — one record too truncated to name a
    // site, one that was never a failed match. Pinned so the divergence from
    // the node's prediction cannot be lost.
    expect(missed.map((m) => m.r.session.slice(0, 8)).sort()).toEqual(["0d27cebf", "516fdfb8"]);
    expect(missed.every((m) => m.r.provenance === "not-replayable")).toBe(true);
  });
});

describe("the live surface — ost_edit_node's drift refusal carries the current text", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-refusal-text-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a write refused for drift quotes the drifted region as it reads now", () => {
    // The guard's own level, with a real concurrent write and no test double:
    // read, let somebody else land, write.
    const file = path.join(dir, "node.md");
    fs.writeFileSync(file, "alpha\nThe original framing of this candidate.\nomega\n", "utf8");
    const read = readWithHash(file);
    fs.writeFileSync(file, "alpha\nA REPLACEMENT framing somebody else wrote.\nomega\n", "utf8");

    let caught: unknown;
    try {
      writeWithHash(file, "alpha\nMy own new framing.\nomega\n", read);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DriftError);
    const message = (caught as Error).message;
    expect(message).toContain("the file changed since you read it");
    // The correction: the text that is there NOW, verbatim and quotable.
    expect(message).toContain("A REPLACEMENT framing somebody else wrote.");
    expect(message).toContain("Retry quoting the text above");
    // Not "go and look" — the looking has already been done and is in the message.
    expect(message).not.toMatch(/re-read the (node|file) and retry/);
  });

  test("ost_edit_node's refusal carries the site rather than sending the caller back to the file", () => {
    const vault = new Vault(dir, { create: true });
    vault.createNode({
      title: "A candidate",
      layer: "Solution",
      status: "unvalidated",
      evidence: "assertion",
      body: "The original framing of this candidate.\nA second line nobody touched.\n",
      tags: [],
      links: [],
    });

    // `editProse` takes its own read and writes microseconds later, so the
    // window its hash guard watches is INSIDE the call — a writer that lands
    // before the call is invisible to it (see the note on `editProse`). The
    // spy plays the concurrent writer at the only instant the guard looks: it
    // answers the guard's pre-write re-read with drifted content, leaving the
    // real `editProse` → `writeWithHash` → `DriftError` path untouched.
    const nodeFile = vault.pathFor("A candidate");
    const onDisk = fs.readFileSync(nodeFile, "utf8");
    const drifted = onDisk.replace(
      "The original framing of this candidate.",
      "A REPLACEMENT framing somebody else wrote.",
    );
    let reads = 0;
    const real = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: string, ...rest: unknown[]) => {
      if (p === nodeFile && ++reads === 2) return drifted;
      return (real as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readFileSync);

    let caught: unknown;
    try {
      vault.editProse("A candidate", "My own new framing.", "sharpening it");
    } catch (err) {
      caught = err;
    } finally {
      spy.mockRestore();
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('cannot edit "A candidate"');
    expect(message).toContain("A REPLACEMENT framing somebody else wrote.");
    expect(message).toContain("Retry quoting the text above");
    // The refusal used to end "— re-read the node and retry the edit", which is
    // the instruction this candidate exists to make unnecessary.
    expect(message).not.toContain("re-read the node");
  });

  test("an edit on a file nobody touched still succeeds — the site lookup costs no false refusals", () => {
    const vault = new Vault(dir, { create: true });
    vault.createNode({
      title: "Untouched",
      layer: "Solution",
      status: "unvalidated",
      evidence: "assertion",
      body: "Body.\n",
      tags: [],
      links: [],
    });
    expect(() => vault.editProse("Untouched", "A new body.", "because")).not.toThrow();
    expect(fs.readFileSync(vault.pathFor("Untouched"), "utf8")).toContain("A new body.");
  });
});
