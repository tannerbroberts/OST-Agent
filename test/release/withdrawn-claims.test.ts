/**
 * A claim this repo withdrew may not come back.
 *
 * Until 2026-07-29 four operator-facing surfaces — `README.md`, the Claude Code
 * consumption guide, the unattended-pass example, and the generated `SKILL.md`
 * — each promised some version of "the worst thing it can do is make a commit
 * that doesn't make sense." That was false, and the readiness document says
 * where: `ost_append_to_node` can write the `## Results` heading `gateSolution`
 * reads (**B1**) and `ost_set_status("validated")` passes `checkInvariants`
 * (**B2**), so a single agent-reachable call moves a gate (**P10**). Revertible,
 * yes; bounded at nonsense, no.
 *
 * The reason this needs a test rather than a careful edit is that the claim was
 * written four different ways in four places, and the fourth was *generated* —
 * `SKILL.md` is rendered from `scripts/gen-skill.ts`, so the false sentence was
 * being loaded into the model's own context on every pass. **D3** compares the
 * skill's tool list against the server's surface and never reads its prose,
 * which is exactly how it got through. A guard on one literal string would have
 * caught one of the four, so this matches a family of phrasings instead.
 *
 * Scope: the surfaces an operator reads to decide whether to trust the thing.
 * `docs/superpowers/` is out — it is a dated design archive, and rewriting what
 * a 2026-07-22 spec argued at the time would be falsifying the record.
 * `docs/reference/v1-readiness.md` is out because it quotes the claim in order
 * to reject it; a guard that fired on the document doing the rejecting is a
 * guard someone turns off.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `scripts/gen-skill.ts` is scanned as well as the `SKILL.md` it renders: the
 * committed skill would catch a reintroduction anyway, but pointing the failure
 * at the generated file sends the next person to edit the file that says "do not
 * edit by hand".
 */
/**
 * The operator-facing surface, plus the two sources that generate part of it.
 * `CONTRIBUTING.md` and `CLAUDE.md` are in because a contributor reads them and
 * the claim is exactly the kind of reassurance that gets copied into one; both
 * are clean today, so they widen the boundary rather than fixing a live gap.
 */
const ROOTS = [
  "README.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  "docs",
  "examples",
  ".claude",
  "src/knowledge/ruleset.ts",
  "scripts/gen-skill.ts",
] as const;

const EXCLUDED = ["docs/superpowers", "docs/reference/v1-readiness.md"] as const;

const TEXTUAL = /\.(md|sh|ya?ml|ts|json)$/;

function walk(rel: string, out: string[]): void {
  if (EXCLUDED.some((e) => rel === e || rel.startsWith(`${e}/`))) return;
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) throw new Error(`scanned root ${rel} does not exist`);
  if (fs.statSync(abs).isDirectory()) {
    for (const entry of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, entry), out);
    return;
  }
  if (TEXTUAL.test(rel)) out.push(rel);
}

function scannedFiles(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) walk(root, out);
  return out;
}

/**
 * Sentence-bounded matching, over whitespace-collapsed text so a claim broken
 * across two lines (the shell script's was) still reads as one sentence.
 *
 * The bound is defensive rather than load-bearing today, and that is worth
 * stating plainly because an earlier version of this comment claimed otherwise.
 * It said the bound was what kept the scan off `evaluating-ost-agent.md`'s "this
 * bounds the worst case and needs no model". It is not: that file contains no
 * `commit` or `nonsens` token anywhere, so it cannot match with or without the
 * bound. Measured across every scanned surface, zero would false-positive even
 * if the whole file were treated as one string.
 *
 * So the bound buys nothing *measurable* right now. It is kept because the
 * scanned set grows, and "worst" discussing one thing a few paragraphs from
 * "commit" discussing another is ordinary prose — the without-bound version
 * fires on a file the moment anyone writes both words. The test below pins the
 * bound directly, so it is a property rather than an assumption.
 */
const sentences = (text: string): string[] => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);

/** A superlative that bounds how bad the agent can be. */
const BOUNDED = /\bworst\b|\bonly failure mode\b/i;
/** …bounded at a commit, or at nonsense. */
const DAMAGE = /\bcommits?\b|\bnonsens\w*\b/i;
/** …or the payload phrase itself, superlative or not. */
const MAKES_NO_SENSE = /(does|do|did)\s?n[o'’]?t\s+make\s+sense|makes?\s+no\s+sense/i;

/**
 * Three pairings rather than one pattern, because the claim's variants differ in
 * which half they state: "the worst case is a git commit that doesn't make
 * sense", "worst case = revertible nonsense commits", "a commit that doesn't
 * make sense, which you revert".
 */
function withdrawnClaim(sentence: string): string | undefined {
  const hasDamage = DAMAGE.test(sentence);
  if (BOUNDED.test(sentence) && hasDamage) return "a superlative bounding the damage at a commit";
  if (hasDamage && MAKES_NO_SENSE.test(sentence)) return "a commit that doesn't make sense";
  if (/\bnonsens\w*\b/i.test(sentence) && /\bcommits?\b/i.test(sentence)) return "the damage named as a nonsense commit";
  return undefined;
}

function hits(): string[] {
  const found: string[] = [];
  for (const file of scannedFiles()) {
    for (const sentence of sentences(fs.readFileSync(path.join(repoRoot, file), "utf8"))) {
      const why = withdrawnClaim(sentence);
      if (why) found.push(`${file}: ${why} — "${sentence.trim().slice(0, 160)}"`);
    }
  }
  return found;
}

describe('the withdrawn "worst case is a nonsensical commit" claim', () => {
  // Anti-vacuity, both directions: the scan has to reach the four files that
  // carried the claim, and the pattern has to still recognise all four wordings.
  test("the scan reaches every surface that carried the claim", () => {
    const files = scannedFiles();
    for (const surface of [
      "README.md",
      "docs/consuming-from-claude-code.md",
      "examples/automation/autonomous-pass.sh",
      ".claude/skills/opportunity-solution-tree/SKILL.md",
      "scripts/gen-skill.ts",
    ]) {
      expect(files, `${surface} is not being scanned`).toContain(surface);
    }
  });

  test("the pattern recognises every wording the claim was written in", () => {
    for (const historical of [
      "**The worst thing OST-Agent can do is make commits that don't make sense.**",
      "The worst you can do is make a commit that doesn't make sense — and that is revertible.",
      "The worst outcome is a commit that doesn't make sense, which you revert.",
      "the worst case is a git commit that doesn't make sense, which is revertible",
      "Worst case = a series of revertible commits containing nonsense.",
      "worst case = revertible nonsense commits",
      // Paraphrases nobody has written yet, which is the point of a family.
      "At worst you get a commit nobody wanted.",
      "The only failure mode is an extra commit.",
    ]) {
      expect(withdrawnClaim(historical.replace(/\s+/g, " ")), historical).toBeTruthy();
    }
  });

  // `sentences()` had no coverage: every other case here calls `withdrawnClaim`
  // on a pre-flattened fixture, so deleting the splitter entirely left this file
  // green. These two route through it, in both directions.
  test("the sentence bound is what separates two unrelated claims from one", () => {
    const split = "This bounds the worst case and needs no model. Every write is a commit.";
    expect(sentences(split)).toHaveLength(2);
    expect(sentences(split).some((s) => withdrawnClaim(s)), split).toBe(false);

    // The same tokens inside one sentence must still be caught — otherwise the
    // bound would be suppressing the claim rather than only its false neighbours.
    const joined = "This bounds the worst case at a commit and needs no model.";
    expect(sentences(joined)).toHaveLength(1);
    expect(sentences(joined).some((s) => withdrawnClaim(s)), joined).toBe(true);
  });

  test("a claim broken across lines is still one sentence", () => {
    // The shell script's version wrapped mid-clause behind two `#` comment
    // markers, which is why the collapse runs before the split.
    const wrapped = "# the worst case is a git commit that doesn't\n# make sense, which is revertible.";
    expect(sentences(wrapped).some((s) => withdrawnClaim(s))).toBe(true);
  });

  test("the pattern leaves the true neighbouring claims alone", () => {
    for (const kept of [
      // The reversibility half is true and load-bearing — withdrawing it too
      // would be the over-correction.
      "Every write is a new append-only git commit, so every write can be reverted.",
      "Anything the agent writes lands as a normal commit you can revert — nothing is ever lost.",
      // A superlative about something other than the agent's damage.
      "Violations fail the scorecard outright. This bounds the worst case and needs no model.",
    ]) {
      expect(withdrawnClaim(kept.replace(/\s+/g, " ")), kept).toBeUndefined();
    }
  });

  test("no operator-facing surface makes the claim", () => {
    expect(hits()).toEqual([]);
  });
});
