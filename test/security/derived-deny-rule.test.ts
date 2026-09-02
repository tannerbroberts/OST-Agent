/**
 * Check a derived deny rule against legitimate uses of the same verb it was
 * derived from.
 *
 * The candidate this measures ("The guard turns each correction into a workspace
 * constraint, so the wrong call stops being expressible") is the most reliable of
 * its three siblings at stopping the repeat and the only dangerous one. A ledger
 * entry that is wrong costs a confused reader; a deny rule that is wrong costs
 * every future session a capability, silently, and its refusal is indistinguishable
 * from the correct guard it was derived from. So the assumption under test is not
 * "does it block the sleep" — it is **can a rule inferred from one refusal be narrow
 * enough not to eat legitimate work.**
 *
 * The bar the node fixed, in three clauses, and every one of them is checked here:
 *
 *   1. **Zero false refusals** across a corpus of legitimate uses of the same verb.
 *      Any legitimate use refused is a failure, not a tuning note.
 *   2. **Every derived rule is attributed to the refusal it came from** — in the
 *      record, and in the message a session gets when the rule fires, because the
 *      danger the node names is a derived refusal that reads like an authored one.
 *   3. **Reversible by one human action.**
 *
 * Two clauses this file adds, because without them clause 1 is trivially passable
 * by a rule that refuses nothing:
 *
 *   4. **Non-vacuity.** The rule must refuse the eight commands this workspace was
 *      actually refused for, carried verbatim out of the transcripts.
 *   5. **The derivation refuses to guess.** A correction whose refusal states no
 *      class yields no rule, and a session cannot activate its own constraint.
 *
 * Everything is derived from `test/fixtures/corrections/*.jsonl` — the real
 * refusals, machine-captured, seven sessions over four days — rather than from a
 * hand-written example of a refusal. A rule derived from prose someone wrote for
 * this test would be measuring the prose.
 *
 * **What a green run here does not settle**, and the node says so first: a corpus
 * can count false refusals among uses somebody thought to assemble. It cannot find
 * the capability nobody realised was lost, because that one is absent from the
 * corpus by definition. It also says nothing about whether an agent deriving its
 * own constraints is acceptable at all — that is a human's call, which is why
 * clause 5 exists and why activation is refused inside a session.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { extractRefusals, foldSightings, emptyCorrectionsLedger } from "../../src/loop/corrections.js";
import type { Correction, RefusalSighting } from "../../src/loop/corrections.js";
import { AGENT_SESSION_MARKERS } from "../../src/security/allowlist-generator.js";
import {
  activateDenyRule,
  deriveDenyRule,
  judgeCommand,
  proposeDenyRule,
  readDenyRules,
  readRefusedShape,
  revokeDenyRule,
  type DerivedDenyRule,
} from "../../src/security/derived-deny.js";
import { WAITING_CASES, permittedWait, probeOf } from "../../src/loop/wait.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(REPO, "test/fixtures/corrections");

/** An environment with nothing in it that marks an agent session — a person's shell. */
const HUMAN_ENV: Record<string, string | undefined> = {};

/** Every refusal in the fixture corpus, as the corrections ledger reads them. */
function fixtureSightings(): RefusalSighting[] {
  const out: RefusalSighting[] = [];
  for (const name of fs.readdirSync(FIXTURES).filter((n) => n.endsWith(".jsonl"))) {
    out.push(...extractRefusals(fs.readFileSync(path.join(FIXTURES, name), "utf8"), name.replace(/\.jsonl$/, "")));
  }
  return out;
}

/** The one correction in the corpus that concerns waiting, folded the way the ledger folds it. */
function waitingCorrection(sightings: readonly RefusalSighting[]): Correction {
  const ledger = foldSightings(emptyCorrectionsLedger(), sightings);
  const found = ledger.corrections.find((c) => /until-loop|run_in_background/i.test(c.permitted));
  if (!found) throw new Error("the fixture corpus no longer contains the sleep correction this suite is about");
  return found;
}

/** The rule under test: derived from the fixtures, then activated by a human. */
function derivedRule(): DerivedDenyRule {
  const sightings = fixtureSightings();
  const derivation = deriveDenyRule({ correction: waitingCorrection(sightings), sightings });
  if (derivation.declined) throw new Error(`expected a rule, got: ${derivation.message}`);
  return derivation.rule;
}

/**
 * Uses of `sleep` this workspace must go on being able to write.
 *
 * Assembled to be adversarial towards the rule rather than kind to it. Four
 * families, and each is a way a verb-shaped rule goes wrong:
 *
 *   - **The verb doing its own job.** A bare delay, a sub-second one, a long one
 *     with nothing after it. None of these is a guess at how long another thing
 *     takes, which is the only thing the refusal was ever about.
 *   - **The permitted form itself.** `until <check>; do sleep 5; done` is what the
 *     guard's message tells the session to write, and it contains the verb. A rule
 *     that ate this would refuse compliance with the correction it came from —
 *     the single worst outcome available, and the reason loop bodies are exempt.
 *   - **The word rather than the command.** In a commit message, a grep pattern, a
 *     filename, a heredoc. The refusal was about a call, not a string.
 *   - **A short wait before an action.** A grace period before a signal or a
 *     request is a fixed sleep followed by a command — structurally the refused
 *     shape — and it is legitimate. This family is why the rule carries a duration
 *     bound taken from the evidence rather than refusing the structure outright.
 */
const LEGITIMATE: readonly { why: string; command: string }[] = [
  { why: "a bare delay in a fixture that needs a real one", command: "sleep 2" },
  { why: "a sub-second delay", command: "sleep 0.25" },
  { why: "a long delay with nothing waiting on it", command: "sleep 300" },
  { why: "a backgrounded delay", command: "sleep 60 &" },
  { why: "a timed run of the verb itself", command: "time sleep 5" },
  {
    why: "the permitted form the guard's own message names",
    command: "until gh pr checks 17; do sleep 30; done",
  },
  {
    why: "the permitted form, with the peek the composer wanted after it",
    command: "until [ -n \"$(gh pr checks 17 2>/dev/null | grep -E 'pass|fail')\" ]; do sleep 45; done; gh pr checks 17",
  },
  {
    why: "a while-loop with a long interval and work in the body",
    command: "while ! test -f build/done; do sleep 60; echo waiting; done",
  },
  {
    why: "a multi-line loop, where the newlines are the separators",
    command: "until npm run gates\ndo\n  sleep 120\ndone\nnpm run gates",
  },
  { why: "the verb named in a commit message", command: 'git commit -m "fix: drop the sleep 45 before the poll"' },
  { why: "the refused shape as a search pattern", command: 'grep -rn "sleep 45; gh pr checks" src/ test/' },
  { why: "the verb in a path", command: "cat scripts/sleep-then-check.sh | head -40" },
  { why: "the verb as an argument to something else", command: "docker run --rm alpine sleep 3600" },
  { why: "the verb written into a file rather than run", command: "printf 'sleep 300\\ngh pr checks 17\\n' > /tmp/poll.sh" },
  { why: "a run of a script that happens to sleep inside it", command: "bash scripts/wait-for-runner.sh && npm test" },
  { why: "a grace period before a signal", command: "sleep 2; kill %1" },
  { why: "a grace period before a request to a server just started", command: "node server.js & sleep 3; curl -sf localhost:3000/health" },
  { why: "a delay after the work, not before a look", command: "npm run bundle && sleep 30" },
  { why: "an interval whose length the shell decides", command: 'sleep "$backoff"; gh pr checks 17' },
  { why: "the affordance that replaced the reflex", command: permittedWait(probeOf(WAITING_CASES[0].blocked)) },
];

/**
 * Calls the rule must refuse, or clause 1 is passed by a rule that does nothing.
 *
 * The first three are `WAITING_CASES` — the `command` field of a refused `Bash`
 * call, byte-for-byte out of the transcript it was refused in. The fourth is the
 * evasion the guard's own remedy anticipates in its closing sentence: "Do not
 * chain shorter sleeps to work around this block."
 */
const MUST_REFUSE: readonly { why: string; command: string }[] = [
  ...WAITING_CASES.map((c) => ({ why: `the ${c.id} reflex, verbatim from session ${c.session}`, command: c.blocked })),
  { why: "the same wait, chained under the threshold to get past the rule", command: "sleep 15; sleep 15; gh pr checks 17" },
];

describe("a deny rule derived from one refusal", () => {
  test("is derived from the refusals themselves, and carries every one of them", () => {
    const sightings = fixtureSightings();
    const rule = derivedRule();

    expect(rule.verb).toBe("sleep");
    expect(rule.tool).toBe("Bash");
    // Attribution, clause 2: the correction it came from, and every refusal that
    // contributed, quoted, with the session it was issued in.
    expect(rule.derivedFrom.correctionId).toBeTruthy();
    expect(rule.derivedFrom.permitted).toMatch(/until-loop/);
    expect(rule.derivedFrom.refusals.length).toBeGreaterThanOrEqual(8);
    for (const refusal of rule.derivedFrom.refusals) {
      expect(refusal.attempted).toMatch(/^Blocked: sleep \d+ followed by:/);
      for (const session of refusal.sessions) {
        expect(sightings.some((s) => s.session === session && s.attempted === refusal.attempted)).toBe(true);
      }
    }
    // Provenance may not inflate. Every recorded refusal is a distinct one, so a
    // caller that can offer only one example call (the corrections ledger keeps
    // exactly one per correction) records one refusal seen in many sessions rather
    // than many refusals — the difference between eight sightings and one repeated.
    const texts = rule.derivedFrom.refusals.map((r) => r.attempted);
    expect(new Set(texts).size).toBe(texts.length);
    const oneExample = deriveDenyRule({
      correction: waitingCorrection(sightings),
      sightings: ["s1", "s2", "s3"].map((session) => ({ ...sightings.find((s) => readRefusedShape(s.attempted))!, session })),
    });
    if (oneExample.declined) throw new Error(oneExample.message);
    expect(oneExample.rule.derivedFrom.refusals).toHaveLength(1);
    expect(oneExample.rule.derivedFrom.refusals[0].sessions).toEqual(["s1", "s2", "s3"]);
    // The bound is the smallest duration any recorded refusal quoted — read off
    // the corpus, not chosen. If a shorter refusal is ever harvested the bound
    // drops with it, which is the only way it may move.
    const quoted = rule.derivedFrom.refusals.map((r) => readRefusedShape(r.attempted)?.seconds ?? Infinity);
    expect(rule.minTotalSeconds).toBe(Math.min(...quoted));
  });

  test("refuses nothing until a human activates it", () => {
    const rule = derivedRule();
    expect(rule.status).toBe("proposed");
    for (const { command } of MUST_REFUSE) {
      expect(judgeCommand([rule], command).denied).toBe(false);
    }
  });

  test("refuses the calls this workspace was actually refused for", () => {
    const rule = { ...derivedRule(), status: "active" as const };
    for (const { why, command } of MUST_REFUSE) {
      const verdict = judgeCommand([rule], command);
      expect(verdict.denied, `should have refused ${why}: ${command}`).toBe(true);
    }
  });

  test("refuses no legitimate use of the same verb", () => {
    const rule = { ...derivedRule(), status: "active" as const };
    const falseRefusals = LEGITIMATE.filter(({ command }) => judgeCommand([rule], command).denied).map(
      ({ why, command }) => `${why}: ${command}`,
    );
    // Clause 1, and it is stated as the whole list rather than one failure at a
    // time: which uses a too-wide rule eats is the finding, not that it ate one.
    expect(falseRefusals).toEqual([]);
  });

  test("says it was derived, from what, and how to reverse it — every time it fires", () => {
    const rule = { ...derivedRule(), status: "active" as const };
    const verdict = judgeCommand([rule], WAITING_CASES[0].blocked);
    if (!verdict.denied) throw new Error("expected a denial to read");

    // The node's stated danger: "the refusal looks exactly like the correct guard
    // it was derived from". A refusal that cites its own provenance does not.
    expect(verdict.message).toMatch(/DERIVED, not authored/);
    expect(verdict.message).toContain(rule.derivedFrom.refusals[0].sessions[0].slice(0, 8));
    expect(verdict.message).toContain(rule.derivedFrom.permitted);
    // The reversal is in the wall the reader hit, not somewhere they have to find.
    expect(verdict.message).toContain(`ost-agent deny --revoke ${rule.id}`);
  });

  test("declines to derive a rule from a refusal that stated no class", () => {
    // "Use one of the available tools instead." is a real ledger entry and names
    // no shape. A rule from it could only be a guess at what was forbidden.
    const sightings: RefusalSighting[] = [
      {
        session: "9aa6b7c9",
        tool: "Bash",
        attempted: "Error: No such tool available: Bash. Bash exists but is not enabled in this context.",
        permitted: "Use one of the available tools instead.",
        at: "2026-08-20T00:00:00.000Z",
      },
    ];
    const derivation = deriveDenyRule({
      correction: { id: "use-one-of-the-available-tools-instead", permitted: sightings[0].permitted },
      sightings,
    });
    expect(derivation.declined).toBe(true);
    if (derivation.declined) expect(derivation.reason).toBe("no-stated-class");
  });
});

describe("the constraint is a human's to impose and one action to remove", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(REPO, "node_modules/.tmp-deny-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test("a session may propose a rule and may not activate it", () => {
    const rule = derivedRule();
    // Proposing is compute's half: an inert record that this class keeps being refused.
    expect(proposeDenyRule(stateDir, rule).ok).toBe(true);
    expect(readDenyRules(stateDir).rules[0].status).toBe("proposed");

    // Activating is not, under any of the markers a session carries.
    for (const marker of AGENT_SESSION_MARKERS) {
      const attempt = activateDenyRule(stateDir, rule.id, { [marker]: "1" });
      expect(attempt.ok, `activation should be refused under ${marker}`).toBe(false);
      if (!attempt.ok) expect(attempt.reason).toBe("agent-session");
      expect(readDenyRules(stateDir).rules[0].status, `${marker} must leave the rule inert`).toBe("proposed");
    }
  });

  test("re-deriving a rule cannot launder it into an active one", () => {
    const rule = derivedRule();
    proposeDenyRule(stateDir, rule);
    expect(activateDenyRule(stateDir, rule.id, HUMAN_ENV).ok).toBe(true);
    expect(readDenyRules(stateDir).rules[0].status).toBe("active");

    // And the reverse direction: a proposal over an active rule must not quietly
    // demote it either, or a session could disarm a constraint by re-deriving it.
    proposeDenyRule(stateDir, rule);
    expect(readDenyRules(stateDir).rules[0].status).toBe("active");
  });

  test("one action removes it, and the call is expressible again", () => {
    const rule = derivedRule();
    proposeDenyRule(stateDir, rule);
    activateDenyRule(stateDir, rule.id, HUMAN_ENV);

    const blocked = WAITING_CASES[0].blocked;
    expect(judgeCommand(readDenyRules(stateDir).rules, blocked).denied).toBe(true);

    // Clause 3. One call, no confirmation, and — unlike activation — no environment
    // check: an action the environment can refuse is not one action.
    const removed = revokeDenyRule(stateDir, rule.id);
    expect(removed.ok).toBe(true);
    expect(readDenyRules(stateDir).rules).toEqual([]);
    expect(judgeCommand(readDenyRules(stateDir).rules, blocked).denied).toBe(false);
  });
});
