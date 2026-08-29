/**
 * The compression-fidelity instrument — every bounded surface is registered,
 * every registered surface states its contract, and the core contracts are
 * driven over real fixtures.
 *
 * This is the instrument for the assumption "the fields a verdict reads can be
 * declared ahead of time and checked mechanically, with no model in the loop".
 * The product's caps were each cut in after an unbounded read did damage, and
 * what the squeeze must PRESERVE lived only in per-module comments — so a new
 * cap could ship silent, and an old one could rot, without anything going red.
 *
 * Three parts, in the order the argument runs (rule-parity's shape):
 *
 * 1. **Census** — every cap constant in `src/` is claimed by exactly one
 *    registered surface, every claimed cap still exists, and no cap has two
 *    owners. Grepped from the source, so a new cap fails the build until
 *    someone writes down what its squeeze preserves.
 * 2. **Contracts** — every surface declares the decision it serves and the
 *    fields that decision reads; the surfaces that clip silently and the ones
 *    whose contract is not yet driven by a test are pinned by name, so both
 *    lists can only shrink without a reviewer seeing the addition.
 * 3. **Fidelity** — for each surface marked `proof: "behavioral"`, the real
 *    production code runs over a fixture and the declared contract is asserted:
 *    counts over the full set, hidden named in prose, true lengths beside
 *    excerpts, `count` never capped, rollup figures re-derived independently.
 *
 * Every assertion has a non-vacuity control, named where it sits: a fixture
 * big enough that something IS truncated, a body long enough that the cap DOES
 * bite, and the small-tree/short-body directions asserting the machinery does
 * not report a truncation that never happened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  censusGaps,
  COMPRESSION_SURFACES,
  SURFACE_BY_NAME,
  type CensusConstant,
} from "../../src/compression/registry.js";
import { MAX_SITE_LINES, renderIntendedSite, textAtIntendedSite } from "../../src/fs/current-text.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import {
  computeNextWork,
  readEvidenceBody,
  EXCERPT_CHARS,
  MAX_BODY_CHARS,
  MAX_ITEMS_PER_LIST,
} from "../../src/mcp/next-work.js";
import { readTreeResponse } from "../../src/security/tools.js";
import { rollupTree } from "../../src/eval/rollup.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";
import { draftRulesetProposal, MAX_RULE_CHARS } from "../../src/knowledge/ruleset-proposal.js";
import { fileFriction } from "../../src/adapters/friction.js";
import { UNKNOWN_ACTOR } from "../../src/adapters/source.js";
import { DATA_FRAME } from "../../src/security/framing.js";
import { buildLargeTree } from "../ost/fixture-vault.js";
import {
  formatFrictionSurfaceReplay,
  frictionSurfaceReplay,
  MAX_IDS_SHOWN,
} from "../../src/telemetry/friction-surface.js";

/**
 * The three fields `fileFriction` now demands. Spread into filings whose subject is
 * something other than the fields themselves, so those tests keep saying what they
 * said — `test/telemetry/self-filed-friction-events.test.ts` is where the fields are
 * the point.
 */
const ACTIONABLE = {
  tool: "ost-agent check",
  input: "--vault (omitted)",
  expected: "it reads ost.vault.yaml and finds the tree",
} as const;


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The census: every cap/budget constant declared in `src/`, read out of the
 * source rather than listed here, so the registry cannot drift quietly.
 *
 * The name shapes are the ones this codebase actually uses for output bounds
 * (`MAX_*`, `DEFAULT_MAX_*`, `*_BUDGET_BYTES`, and the two mavericks named
 * outright). A cap that adopts a new shape evades this census — which is why
 * the anchors below pin the regex to two constants that must always match, so
 * a regex that silently stops matching fails loudly rather than passing an
 * empty census.
 */
const CAP_DECLARATION =
  /^(?:export )?const (MAX_[A-Z0-9_]+|DEFAULT_MAX_[A-Z0-9_]+|[A-Z0-9_]+_BUDGET_BYTES|EXCERPT_CHARS|DIRTY_PATHS_SHOWN) = /gm;

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function censusFromSource(): CensusConstant[] {
  const found: CensusConstant[] = [];
  for (const file of srcFiles(path.join(repoRoot, "src"))) {
    const module = path.relative(repoRoot, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(CAP_DECLARATION)) found.push({ module, name: m[1] });
  }
  return found;
}

describe("census — the registry and the source agree about every cap", () => {
  const found = censusFromSource();

  test("the census grep still finds real constants (anchor control)", () => {
    // If the regex or the walk breaks, these two vanish and this fails before
    // the empty-census below could pass as "nothing unclaimed".
    expect(found).toContainEqual({ module: "src/mcp/next-work.ts", name: "EXCERPT_CHARS" });
    expect(found).toContainEqual({ module: "src/security/tools.ts", name: "READ_TREE_BUDGET_BYTES" });
    expect(found.length).toBeGreaterThanOrEqual(30);
  });

  test("every cap constant in src/ is claimed by exactly one surface, and none is phantom", () => {
    const gaps = censusGaps(found);
    expect(gaps.unclaimed, "new cap constants must be registered in src/compression/registry.ts with the contract their squeeze preserves").toEqual([]);
    expect(gaps.phantom, "the registry claims caps that no longer exist — registry rot").toEqual([]);
    expect(gaps.doubleClaimed, "a cap with two owning surfaces has no contract").toEqual([]);
  });

  test("surface names are unique and every registered module exists", () => {
    expect(SURFACE_BY_NAME.size).toBe(COMPRESSION_SURFACES.length);
    for (const s of COMPRESSION_SURFACES) {
      expect(fs.existsSync(path.join(repoRoot, s.module)), `${s.name}: ${s.module} does not exist`).toBe(true);
    }
  });
});

/**
 * The two ratchets. Both lists are pinned BY NAME, outside the registry,
 * because a ratchet that lives inside the thing it pins is a comment.
 *
 * Shrinking either list is progress and needs no ceremony — delete the name
 * here in the same commit. GROWING either list means shipping a new silent
 * clip or a new unproven contract, and this pin is what makes that a reviewed
 * decision instead of a drift.
 */
const SILENT_SURFACES = [
  "actions history fetch",
  "broker detail clip",
  "census firing history window",
  "census quoted sources",
  // Grown deliberately with the deposit channel: the clip binds only the
  // agent-authored from/closing metadata — the collaborator's answer is never
  // clipped, which is the surface's whole contract.
  "deposit metadata clip",
  "friction filing clip",
  "hand-exclusion command clip",
  "near-miss ancestor walk",
  "path-failure attribution clips",
  "preflight excerpt clip",
  "repo listing",
  "retrospective field clip",
  "search-literality excerpt clip",
  "sense census detail",
  // Grown deliberately with the symbol-failure census, on the same terms as the
  // sibling censuses above: the clip binds only text carried for a human reader —
  // the command, the compiler's message, the repair evidence. Every value the
  // census computes from is read off the UNCLIPPED text before the clip is
  // applied: the symbol and the `Did you mean` come out of the full message,
  // `isTypecheckCommand` runs against the full command, and the resolution is
  // decided from the full edit. No cap here can move the number it reports.
  "symbol-failure text clip",
  "title sanitization",
  "transcript adapter event digest",
  "usage rollup error clip",
  "web redirect walk",
  "web search request",
] as const;

const DECLARATION_ONLY_SURFACES = [
  "actions history fetch",
  "analysis renders",
  "broker detail clip",
  "capability record refs",
  "census firing history window",
  "census quoted sources",
  "corrections ledger",
  "deposit metadata clip",
  "dirty-path refusal listing",
  "friction filing clip",
  "hand-exclusion command clip",
  "ingest report titles",
  "near-miss ancestor walk",
  "near-miss directory listing",
  "path-failure attribution clips",
  "preflight excerpt clip",
  "repo file read",
  "repo listing",
  "retrospective field clip",
  "search-literality excerpt clip",
  "sense census detail",
  "standing briefing recent-node window",
  "symbol-failure text clip",
  "title sanitization",
  "transcript adapter event digest",
  "transcript reading served to the model reader",
  "usage rollup error clip",
  "web page read",
  "web redirect walk",
  "web search request",
] as const;

describe("contracts — every surface states what its squeeze preserves", () => {
  test("every surface declares a decision and a non-empty reads contract", () => {
    for (const s of COMPRESSION_SURFACES) {
      expect(s.decision.trim().length, `${s.name}: empty decision`).toBeGreaterThan(0);
      expect(s.reads.length, `${s.name}: a surface with no declared reads is a cap nobody can judge`).toBeGreaterThan(0);
      for (const r of s.reads) expect(r.trim().length, `${s.name}: blank read`).toBeGreaterThan(0);
    }
  });

  test("the silent-clip list only shrinks", () => {
    const silent = COMPRESSION_SURFACES.filter((s) => s.drops === "silent").map((s) => s.name).sort();
    expect(silent).toEqual([...SILENT_SURFACES].sort());
  });

  test("the declaration-only list only shrinks, and every behavioral surface has a drive", () => {
    const declared = COMPRESSION_SURFACES.filter((s) => s.proof === "declaration").map((s) => s.name).sort();
    expect(declared).toEqual([...DECLARATION_ONLY_SURFACES].sort());

    const behavioral = COMPRESSION_SURFACES.filter((s) => s.proof === "behavioral").map((s) => s.name).sort();
    expect(behavioral, "a surface marked behavioral with no drive below would be a proof that never runs").toEqual(
      [...DRIVEN_SURFACES].sort(),
    );
  });
});

/** The surfaces part 3 drives. Kept beside the drives so totality is checkable above. */
const DRIVEN_SURFACES = [
  "computed rollup",
  "evidence body channel",
  "failed-match site excerpt",
  "friction-surface report id lists",
  "next-work sweep",
  "ruleset proposal bound",
  "tree read",
] as const;

/** Big enough that the sweep truncates and the tree read overflows nothing — see each control. */
const SHAPE = { opportunities: 60, solutions: 60, assumptionTests: 60 };
const OUTCOME = "Retention";

/** A body long enough that both the excerpt cap and the body-channel cap bite. */
const LONG_BODY = `${"operators keep saying the first hour is the whole product. ".repeat(1100)}`;
/** Exists only past the excerpt cap AND past MAX_BODY_CHARS, so both clips are decidable. */
const TAIL_MARKER = "the fourteenth interview said the same thing";
const EVIDENCE_ID = "INBOX:compression-fidelity-fixture.md";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-fidelity-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
}, 120_000);
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("fidelity — the behavioral surfaces preserve their declared reads", () => {
  test(
    "next-work sweep: counts over the full set, hidden named in prose, excerpt beside its true length",
    async () => {
      const ctx = buildPassContext(dir);
      buildLargeTree(ctx.vault, OUTCOME, SHAPE);
      const tree = ctx.vault.readTree();
      writeEvidence(dir, {
        id: EVIDENCE_ID,
        source: EVIDENCE_ID,
        title: "compression fidelity fixture",
        body: `${LONG_BODY}\n${TAIL_MARKER}\n`,
        timestamp: "2026-08-11T00:00:00.000Z",
      }, UNKNOWN_ACTOR);

      const work = computeNextWork(ctx.vault, dir, 3);

      // Control: the fixture is big enough that something WAS truncated.
      expect(work.truncated.length).toBeGreaterThan(0);

      // "each capped list carries a truncation record whose hidden equals total minus shown"
      // "the hidden totals appear in the summary prose, not only in a field"
      for (const t of work.truncated) {
        expect(t.shown).toBeLessThanOrEqual(MAX_ITEMS_PER_LIST);
        expect(t.hidden).toBe(t.total - t.shown);
        expect(t.hidden).toBeGreaterThan(0);
        expect(work.summary).toContain(String(t.total));
      }

      // "every count and the done verdict are computed over the full set" — the
      // denominator recomputed here, off the tree, not read back out of the response.
      const layerOf = new Map(tree.map((n) => [n.title, n.layer]));
      let underserved = 0;
      for (const n of tree) {
        if (n.layer !== "Opportunity") continue;
        const solutions = n.links.filter((l) => layerOf.get(l) === "Solution").length;
        if (solutions < 3) underserved++;
      }
      expect(underserved, "control: the fixture must underserve more than one cap's worth").toBeGreaterThan(MAX_ITEMS_PER_LIST);
      const reported = work.truncated.find((t) => t.list === "underservedOpportunities");
      expect(reported?.total).toBe(underserved);
      expect(work.done).toBe(false);

      // "an excerpt travels with the true body length, and the full-body channel is named"
      const item = work.unmappedEvidence.find((e) => e.id === EVIDENCE_ID);
      expect(item, "the evidence record did not surface — the excerpt assertions would be vacuous").toBeTruthy();
      // "true body length" means the length of the STORED record — the store
      // normalizes a trailing newline, so the truth is read back off disk here,
      // independently of the response under test.
      const stored = readEvidence(dir).find((e) => e.id === EVIDENCE_ID);
      expect(stored, "the fixture record is not in the store").toBeTruthy();
      expect(stored!.body.length, "control: the stored body must dwarf the excerpt cap").toBeGreaterThan(EXCERPT_CHARS * 10);
      expect(item!.bodyChars).toBe(stored!.body.length);
      expect(item!.excerpt.replace(`${DATA_FRAME}\n---\n`, "").length).toBe(EXCERPT_CHARS);
      expect(item!.excerpt).not.toContain(TAIL_MARKER);
      expect(work.summary).toMatch(/ost_next_work with \{ evidence/);
    },
    120_000,
  );

  test(
    "evidence body channel: the served body names its true length, and the label names its units",
    async () => {
      buildPassContext(dir);
      const body = `${LONG_BODY}\n${TAIL_MARKER}\n`;
      writeEvidence(dir, {
        id: EVIDENCE_ID,
        source: EVIDENCE_ID,
        title: "compression fidelity fixture",
        body,
        timestamp: "2026-08-11T00:00:00.000Z",
      }, UNKNOWN_ACTOR);

      // The stored body is the truth the response must be measured against —
      // the store normalizes a trailing newline, so its length is read back off
      // disk rather than assumed from the string written above.
      const stored = readEvidence(dir).find((e) => e.id === EVIDENCE_ID);
      expect(stored, "the fixture record is not in the store").toBeTruthy();
      const storedChars = stored!.body.length;
      // Control: the cap must actually bite, or the truncation assertions are decoration.
      expect(storedChars).toBeGreaterThan(MAX_BODY_CHARS);

      const record = readEvidenceBody(dir, EVIDENCE_ID);
      expect(record.bodyChars).toBe(storedChars);
      expect(record.truncated).toEqual([
        { list: "body (characters)", shown: MAX_BODY_CHARS, total: storedChars, hidden: storedChars - MAX_BODY_CHARS },
      ]);
      // The tail fell past the cap — and the record SAYS so rather than serving
      // a body that reads as complete.
      expect(record.body).not.toContain(TAIL_MARKER);

      // The other direction: a body the cap does not touch reports no truncation.
      const shortId = "INBOX:short-fixture.md";
      writeEvidence(dir, {
        id: shortId,
        source: shortId,
        title: "short fixture",
        body: "small enough to serve whole",
        timestamp: "2026-08-11T00:00:00.000Z",
      }, UNKNOWN_ACTOR);
      const short = readEvidenceBody(dir, shortId);
      expect(short.truncated).toEqual([]);
      expect(short.body).toContain("small enough to serve whole");
    },
    120_000,
  );

  test(
    "ruleset proposal bound: a draft past the cap is refused whole, and one at the cap survives verbatim",
    () => {
      const filing = path.basename(fileFriction(dir, { ...ACTIONABLE, kind: "unclear-rule", note: "same friction three passes running" }));

      // Control: the cap must actually bite — one character over is refused, and
      // the refusal names both the length and the cap rather than clipping.
      const over = "r".repeat(MAX_RULE_CHARS + 1);
      expect(() =>
        draftRulesetProposal(dir, {
          section: "agentMust",
          rule: over,
          rationale: "long enough to matter",
          evidence: [filing],
          at: "2026-08-11T00:00:00.000Z",
        }),
      ).toThrow(new RegExp(`${MAX_RULE_CHARS + 1}.*${MAX_RULE_CHARS}`));

      // The other direction: at the cap, every byte survives into the file a
      // human reviews — the reviewed text and the adoptable text are the same.
      const atCap = "r".repeat(MAX_RULE_CHARS);
      const proposal = draftRulesetProposal(dir, {
        section: "agentMust",
        rule: atCap,
        rationale: "long enough to matter",
        evidence: [filing],
        at: "2026-08-11T00:00:00.000Z",
      });
      expect(proposal.rule).toBe(atCap);
      expect(fs.readFileSync(proposal.file, "utf8")).toContain(atCap);
    },
    120_000,
  );

  test(
    "tree read: count is never capped, shown plus hidden equals count, the note names the full tree",
    async () => {
      const ctx = buildPassContext(dir);
      buildLargeTree(ctx.vault, OUTCOME, SHAPE);
      const tree = ctx.vault.readTree();

      const response = readTreeResponse(tree);
      expect(response.count).toBe(tree.length);
      expect(response.shown + response.hidden).toBe(response.count);
      if (response.hidden > 0) expect(response.note).toContain(String(response.count));

      // The small-tree direction: nothing hidden, and no note claiming otherwise.
      const small = readTreeResponse(tree.slice(0, 3));
      expect(small.hidden).toBe(0);
      expect(small.shown).toBe(small.count);
      expect(small.note).toBeUndefined();
    },
    120_000,
  );

  test(
    "computed rollup: every figure re-derivable from the full tree, and unfiled reported rather than omitted",
    async () => {
      const ctx = buildPassContext(dir);
      buildLargeTree(ctx.vault, OUTCOME, SHAPE);
      // An opportunity nobody filed under the outcome — the rollup must report
      // it, because omitting it would read as complete coverage.
      ctx.vault.createNode({
        title: "Customers cannot find the unfiled need",
        layer: "Opportunity",
        evidence: "observed",
        source: "INBOX:n.md",
        body: "b",
        tags: [],
        links: [],
      });
      const tree = ctx.vault.readTree();

      const rollup = rollupTree(tree);

      // "every figure is derived from the full tree at read time" — totals
      // recomputed independently here.
      expect(rollup.totals.nodes).toBe(tree.length);
      expect(rollup.totals.opportunities).toBe(tree.filter((n) => n.layer === "Opportunity").length);
      expect(rollup.totals.solutions).toBe(tree.filter((n) => n.layer === "Solution").length);
      expect(rollup.totals.tests).toBe(tree.filter((n) => n.layer === "AssumptionTest").length);

      // One bucket's opportunity figure, re-derived by a walk this test owns.
      const index = new Map(tree.map((n) => [n.title, n]));
      const bucket = rollup.buckets[0];
      expect(bucket, "control: the fixture wired buckets under the outcome").toBeTruthy();
      const seen = new Set<string>();
      const queue = [bucket.title];
      while (queue.length > 0) {
        const title = queue.shift() as string;
        if (seen.has(title)) continue;
        seen.add(title);
        for (const l of index.get(title)?.links ?? []) queue.push(l);
      }
      const reachableOpportunities = [...seen].filter((t) => index.get(t)?.layer === "Opportunity").length;
      expect(bucket.opportunities).toBe(reachableOpportunities - 1); // the bucket is not one of the needs it files

      // "nodes the walk could not file are reported as unfiled, never silently omitted"
      expect(rollup.unfiled).toContain("Customers cannot find the unfiled need");
    },
    120_000,
  );

  test("failed-match site excerpt: the shown text is verbatim, and a clip says how much it is showing", () => {
    // The decision this bound serves is "can I retry from the refusal alone",
    // so the contract is stricter than "it fits": the excerpt has to be a
    // substring of the file, or the retry composed from it misses again.
    const file = Array.from({ length: 400 }, (_, i) => `line ${i} as the file holds it`).join("\n");

    // Control, small: a quote well inside the cap is not reported as clipped.
    const small = textAtIntendedSite(file, "line 7 as the CALLER remembered it");
    expect(small.kind).toBe("site");
    if (small.kind !== "site") return;
    expect(small.site.truncated).toBe(false);
    expect(file).toContain(small.site.text);

    // Control, large: a quote past the cap IS clipped, and says so with both
    // numbers — the shown count and the true length of what was asked for.
    const quoted = Array.from({ length: 120 }, (_, i) => `line ${i} as the CALLER remembered it`).join("\n");
    const big = textAtIntendedSite(file, quoted);
    expect(big.kind).toBe("site");
    if (big.kind !== "site") return;
    expect(big.site.truncated).toBe(true);
    expect(big.site.text.split("\n").length).toBe(MAX_SITE_LINES);
    expect(file, "a clipped excerpt is still verbatim — it is the retry's quote").toContain(big.site.text);
    const rendered = renderIntendedSite(big, "f.ts");
    expect(rendered).toContain(`first ${MAX_SITE_LINES} of ${big.site.linesQuoted} lines`);
  });

  test("friction-surface report: every count is over the full set, and a clipped list says how many more", () => {
    // The decision this bound serves is "which of my friction records got
    // filed", so the contract is that the *counts* never move with the cap — a
    // reader who acts on "197 filed" must not be reading the length of a list
    // that was squeezed to fit a line.
    const filed = (n: number) => ({
      id: `USAGE:${String(n).padStart(3, "0")}`,
      file: `USAGE_${n}.md`,
      kind: "usage" as const,
      truncated: false,
      events: [{ kind: "tool_error", tool: "ost_annotate", detail: "no such node", command: "" }],
    });

    // Control, small: a list inside the cap is printed whole and reports no
    // remainder, so the machinery cannot claim a squeeze that never happened.
    const few = Array.from({ length: 3 }, (_, i) => filed(i));
    const smallReport = formatFrictionSurfaceReplay(frictionSurfaceReplay(few, []));
    expect(smallReport).toContain("3 record(s) — 3 filed, 0 counted, 0 discarded");
    expect(smallReport).not.toContain("more");

    // Control, large: past the cap the line IS squeezed, and both numbers
    // survive — the headline count over the full set, and the remainder.
    const many = Array.from({ length: MAX_IDS_SHOWN + 12 }, (_, i) => filed(i));
    const bigReport = formatFrictionSurfaceReplay(frictionSurfaceReplay(many, []));
    expect(bigReport).toContain(`${many.length} record(s) — ${many.length} filed`);
    expect(bigReport).toContain("… and 12 more");
    // The shown ids are the leading ones, verbatim — not a re-ordered sample.
    expect(bigReport).toContain(many.slice(0, MAX_IDS_SHOWN).map((r) => r.id).join(", "));
  });
});
