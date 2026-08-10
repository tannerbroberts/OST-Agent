/**
 * The instrument for "A pass ends by reporting which of its senses were live and
 * which it never had."
 *
 * **What it is scoring, taken from the assumption test's pre-committed
 * threshold rather than from what got built.** That threshold, in full: *"The
 * closing report lists every sense with a state, including senses nothing reached
 * for during the run. A sense that was never tried must be distinguishable from
 * one that worked — if the two render identically, this is refuted."* Its named
 * fixture is a pass run with `product.repos` unconfigured and the web budget
 * spent, and its stated requirement is that the states be derived *from config and
 * grant, not from what the pass happened to touch*.
 *
 * Those are four separate claims and they are tested separately below, because
 * three of them can pass while the demanding one fails — which is exactly the
 * refutation the node predicts in advance:
 *
 *   > If the census can only be assembled from observed denials, then a sense
 *   > nothing tried renders as fine, and the mechanism has reproduced the exact
 *   > ambiguity it was built to remove. That is a refutation of the assumption,
 *   > not a bug in the test.
 *
 * So {@link describe} "a sense nothing reached for does not render as one that
 * worked" is the one that decides this node, and it asserts on *rendered strings
 * being unequal* rather than on any internal field: a census that knew the
 * difference internally and printed it identically would still have failed the
 * operator, and the threshold is written about the report.
 *
 * **What a green here does not prove.** That anyone reads the census. The node's
 * own "Where it fails" section concedes it — "a report at the end is a report
 * nobody may read" — and this file cannot answer a question about people. It also
 * does not prove the degraded work stops being written; making a failure visible
 * is not making it not happen, and the honest claim for a green here is only the
 * former.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assembleCensus,
  senseCensusReport,
  toolCallsByToolSince,
  HARNESS_SENSE,
  type SenseObservation,
} from "../../src/loop/senses.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../src/cli/index.ts");
const TSX = path.resolve(here, "../../node_modules/.bin/tsx");

let dir: string;
let vault: string;
let sessions: string;
let productRepo: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: vault, stdio: "ignore" });
}

function loop(subcommand: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * The fixture the assumption test names: a loop that can fire, and a web budget
 * small enough that a handful of traced lookups spends it.
 */
const FULL_LOOP = [
  'outcome: "ship it"',
  "loop:",
  '  cadence: "6h"',
  "  spend:",
  "    ceilingWeightedTokens: 1000",
  "    windowHours: 24",
  '    sessionsDir: "../sessions"',
  "web:",
  "  lookupBudget: 2",
  "",
].join("\n");

function writeConfig(text: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), text, "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "config");
}

/** One traced tool invocation, exactly as `withUsageTracing` writes them. */
function traceToolCall(tool = "ost_next_work"): void {
  const file = usageLogPath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    JSON.stringify({ ts: new Date().toISOString(), tool, ok: true, ms: 3, surface: "mcp", argBytes: 12 }) + "\n",
    "utf8",
  );
}

/** A whole firing bracket. `tools` is what the pass reached for while it ran. */
function fire(tools: readonly string[] = ["ost_next_work"]): { code: number; out: string } {
  loop("start");
  loop("step", "--phase", "pass", "--", "true");
  for (const t of tools) traceToolCall(t);
  loop("step", "--phase", "check", "--", "true");
  return loop("seal");
}

/** The census block of a closing report, as the lines an operator reads. */
function censusLines(out: string): string[] {
  const all = out.split("\n");
  const start = all.findIndex((l) => l.startsWith("senses this firing had:"));
  expect(start, `no sense census in the closing report:\n${out}`).toBeGreaterThanOrEqual(0);
  return all.slice(start + 1).filter((l) => l.startsWith("  ["));
}

/** The one line for a named sense, or undefined if the census omitted it. */
function senseLine(out: string, name: string): string | undefined {
  return censusLines(out).find((l) => l.startsWith(`  [${name}]`));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-senses-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  productRepo = path.join(dir, "product");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  fs.mkdirSync(productRepo);
  fs.writeFileSync(path.join(productRepo, "index.ts"), "export const x = 1;\n");
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(sessions, "s.jsonl"), "");
  // Tracked from the baseline for the reason the degraded fixture documents: an
  // untracked `.ost-agent/` collapses in git status and trips the dirty-tree
  // refusal at the next `loop start`, for a reason unrelated to this file.
  fs.mkdirSync(path.dirname(usageLogPath(vault)), { recursive: true });
  fs.writeFileSync(usageLogPath(vault), "");
  writeConfig(FULL_LOOP);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * The threshold's first clause, against the threshold's own named fixture:
 * `product.repos` unconfigured and the web budget spent.
 */
describe("the closing report lists every sense with a state", () => {
  test("a pass with product.repos unconfigured says so by name, in the closing report", () => {
    // Nothing in this firing reads a repo, and nothing needs to: the state comes
    // off the config. That is the `ost_ingest_inbox` property this borrows.
    const sealed = fire();

    expect(sealed.out).toMatch(/senses this firing had:/);
    expect(senseLine(sealed.out, "product-repo")).toMatch(/absent/);
    expect(senseLine(sealed.out, "product-repo")).toMatch(/product\.repos is empty/);
  });

  test("a spent web budget is reported as spent, not as a sense that was fine", () => {
    // `web.lookupBudget: 2` in the fixture, and two traced page reads against it.
    const sealed = fire(["ost_read_web", "ost_read_web"]);

    expect(senseLine(sealed.out, "web-read")).toMatch(/exhausted/);
    expect(senseLine(sealed.out, "web-read")).toMatch(/2 of web\.lookupBudget's 2/);
  });

  test("every sense carries a state word — no line is left with a name and nothing else", () => {
    const lines = censusLines(fire().out);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `sense line carries no state: ${line}`).toMatch(
        /^ {2}\[[^\]]+\] (live|delegated|disabled|unavailable|absent|exhausted|unknown) — /,
      );
    }
  });

  test("a channel the operator turned off appears anyway, which is the precedent being borrowed", () => {
    // `ost_ingest_inbox` reports the disabled channels rather than omitting them,
    // and a census that listed only what it could see would read as complete.
    const sealed = fire();
    expect(senseLine(sealed.out, "slack")).toMatch(/disabled/);
    expect(senseLine(sealed.out, "atlassian")).toMatch(/disabled/);
  });

  test("the census is printed on a firing that seals fine, not only on a degraded one", () => {
    // The firing this exists for is the one that LOOKS healthy. A census that
    // appeared only beside a degradation could never tell an operator that a
    // clean-sealing pass spent the night unable to see the product.
    const sealed = fire();
    expect(sealed.out).not.toMatch(/sealed: degraded/);
    expect(sealed.out).toMatch(/senses this firing had:/);
  });
});

/**
 * The demanding clause, and the one this node turns on. Asserted on the RENDERED
 * lines, because the threshold is written about the report: a census that knew
 * the difference internally and printed it identically would still have failed.
 */
describe("a sense nothing reached for does not render as one that worked", () => {
  test("the same configured sense renders differently when it was reached and when it was not", () => {
    // Two firings, identical configuration, differing only in what the pass
    // reached for. If these two lines match, the census is assembled from
    // observed denials and the assumption is refuted.
    writeConfig(`${FULL_LOOP}product:\n  repos: ["${productRepo}"]\n`);

    const untouched = senseLine(fire(["ost_next_work"]).out, "product-repo");
    const reached = senseLine(fire(["ost_read_repo"]).out, "product-repo");

    expect(untouched).toBeDefined();
    expect(reached).toBeDefined();
    expect(untouched).not.toEqual(reached);
    // And not merely different — different in the direction that means something.
    expect(untouched).toMatch(/never reached/);
    expect(reached).toMatch(/reached 1×/);
    // Both are `live`: the STATE is config-derived and identical, so the reach
    // clause is carrying the whole distinction. That is the design under test.
    expect(untouched).toMatch(/\[product-repo\] live/);
    expect(reached).toMatch(/\[product-repo\] live/);
  });

  test("the report says outright that a never-reached sense is not a working one", () => {
    // Without this sentence a reader completes it the wrong way, which is the
    // ambiguity the whole candidate exists to remove.
    expect(fire().out).toMatch(/a sense nothing reached for is not a sense that worked/);
  });

  test("the sense whose grant this vault cannot see says so, instead of reporting zero reach", () => {
    // The assumption node predicted this half is not derivable: a vault cannot
    // enumerate a harness grant living in another process. Reporting it as
    // `never reached` would be this census committing its own error — "nothing
    // called it" and "nothing here could tell" are different facts.
    const line = senseLine(fire().out, HARNESS_SENSE);
    expect(line).toMatch(/unknown/);
    expect(line).toMatch(/not observable from here/);
    expect(line).not.toMatch(/never reached/);
  });
});

/**
 * "Derived from config and grant, not from what the pass happened to touch."
 * Driven through the pure fold, so every state is exercised without standing up
 * the credential or the broken repo that produces it.
 */
describe("states come from configuration, not from what was tried", () => {
  const base: SenseObservation = {
    tree: { readable: true, detail: "the vault's own tree" },
    productRepos: [],
    unreadableRepos: [],
    search: "none",
    webLookupBudget: 10,
    channels: [],
    callsByTool: {},
  };

  test("a live sense with zero calls is still live — availability is not inferred from use", () => {
    const senses = assembleCensus({ ...base, productRepos: ["/tmp/repo"] });
    const repo = senses.find((s) => s.name === "product-repo");
    expect(repo?.state).toBe("live");
    expect(repo?.reached).toBe(0);
  });

  test("a declared repo that cannot be read is `unavailable`, which is not `absent`", () => {
    // The two are different facts about the operator's intent — one asked for
    // nothing, the other asked and did not get it — and rounding them together
    // is what makes a report unactionable.
    const senses = assembleCensus({
      ...base,
      productRepos: ["/tmp/repo"],
      unreadableRepos: [{ path: "/tmp/repo", reason: "ENOENT" }],
    });
    expect(senses.find((s) => s.name === "product-repo")?.state).toBe("unavailable");
    expect(assembleCensus(base).find((s) => s.name === "product-repo")?.state).toBe("absent");
  });

  test("search with no provider is `delegated` rather than absent, and never spends the budget", () => {
    // `ost_search_web` returns the delegation instruction BEFORE taking a token,
    // so counting those calls would report a firing exhausted on lookups that
    // cost nothing.
    const senses = assembleCensus({
      ...base,
      webLookupBudget: 1,
      callsByTool: { ost_search_web: 5 },
    });
    expect(senses.find((s) => s.name === "web-search")?.state).toBe("delegated");
    expect(senses.find((s) => s.name === "web-read")?.state).toBe("live");
  });

  test("a held credential plus a spent allowance reads `exhausted`", () => {
    const senses = assembleCensus({
      ...base,
      search: "credential",
      webLookupBudget: 2,
      callsByTool: { ost_search_web: 1, ost_read_web: 1 },
    });
    expect(senses.find((s) => s.name === "web-search")?.state).toBe("exhausted");
    expect(senses.find((s) => s.name === "web-read")?.state).toBe("exhausted");
  });

  test("an uninspectable surface reports unknown rather than an empty census", () => {
    // A census that could not be built and rendered as "no senses" would be the
    // silent-degradation failure again, one level up.
    const senses = assembleCensus({ ...base, observationFailure: "EACCES" });
    expect(senses).toHaveLength(1);
    expect(senses[0].state).toBe("unknown");
    expect(senseCensusReport(senses).join("\n")).toMatch(/unknown is not clean/);
  });

  test("nothing is invented: a census with no channels reports no channels", () => {
    const names = assembleCensus(base).map((s) => s.name);
    expect(names).toEqual(["tree", "product-repo", "web-search", "web-read", HARNESS_SENSE]);
  });
});

/**
 * Found by reading a real closing report rather than by reasoning about one, which
 * is the only way either of these was going to surface: both passed every
 * assertion above while making the report materially worse to read.
 */
describe("the report stays readable, because an unread report is this candidate's own failure mode", () => {
  const base: SenseObservation = {
    tree: { readable: true, detail: "t" },
    productRepos: [],
    unreadableRepos: [],
    search: "none",
    webLookupBudget: 10,
    channels: [],
    callsByTool: {},
  };

  test("a sense whose detail runs to paragraphs is cut, and the state and reach survive the cut", () => {
    // Observed live: an unreadable tree hands back `vaultReadiness`'s full setup
    // guidance — six sentences and a shell command — and the flattened line ran to
    // ~600 characters, pushing every other sense off the reader's screen. The
    // detail is not this module's text and cannot be trusted to be short.
    const long = "x".repeat(900);
    const line = senseCensusReport(assembleCensus({ ...base, tree: { readable: false, detail: long } }))[1];

    expect(line.length).toBeLessThan(260);
    expect(line).toMatch(/^ {2}\[tree\] unavailable — /);
    // The two load-bearing clauses are still there after the cut.
    expect(line).toMatch(/…/);
    expect(line).toMatch(/never reached$/);
  });

  test("the shared-channel-reach caveat is stated once, not repeated on every channel", () => {
    // Six channels is an ordinary vault. Repeating the same ninety-character
    // clause six times is how a report stops being finished.
    const report = senseCensusReport(
      assembleCensus({
        ...base,
        channels: ["inbox", "friction", "transcript", "usage", "atlassian", "slack"].map((name) => ({
          name,
          kind: "live" as const,
        })),
      }),
    ).join("\n");

    expect(report.match(/reads every channel in one call/g)).toHaveLength(1);
    expect(report).toMatch(/\[inbox\] live — declared and constructed; never reached/);
  });

  test("a census with no channels does not caveat channels it does not have", () => {
    expect(senseCensusReport(assembleCensus(base)).join("\n")).not.toMatch(/Channel reach is shared/);
  });
});

describe("reach is read off the trace, which the pass cannot author", () => {
  test("only calls inside the firing's own window are counted", () => {
    traceToolCall("ost_read_repo");
    const cutoff = new Date(Date.now() + 1).toISOString();
    // Everything above happened BEFORE this window opened; a census that counted
    // it would credit this firing with another firing's reach.
    expect(toolCallsByToolSince(vault, cutoff).ost_read_repo).toBeUndefined();
    expect(toolCallsByToolSince(vault, new Date(0).toISOString()).ost_read_repo).toBe(1);
  });

  test("a mutating tree call counts as having reached the tree", () => {
    // A pass that only WROTE nodes still reached the tree, and a mapping that
    // admitted reads alone would report the most productive firings as blind.
    const senses = assembleCensus({
      tree: { readable: true, detail: "t" },
      productRepos: [],
      unreadableRepos: [],
      search: "none",
      webLookupBudget: 10,
      channels: [],
      callsByTool: { ost_create_node: 3 },
    });
    expect(senses.find((s) => s.name === "tree")?.reached).toBe(3);
  });
});
