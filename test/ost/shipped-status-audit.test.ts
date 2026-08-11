/**
 * Audit every shipped solution against the repository before trusting the
 * exclusion.
 *
 * `solutionsMissingInstruments` asks each solution for a red-now command, and
 * built behaviour cannot carry one — so shipped solutions leave that queue.
 * The claim being pinned is the safety edge of that exclusion, not its
 * convenience: `status: shipped` is a field an agent can set, and a solution
 * wrongly marked shipped would vanish from the one queue that would have
 * chased it. So the exclusion trusts a promotion only when `## History`
 * records it with reasoning attached, and this spec additionally audits the
 * trusted set against the repository — every module or spec a trusted node
 * names must be a real file.
 *
 * The final block runs that audit against the LIVE tree this repository's
 * committed pointer names, when that vault is reachable (it is wherever the
 * build loop runs; a bare CI clone has no vault, and the block says so by
 * skipping visibly rather than passing vacuously). A pass here proves paths
 * resolve and promotions are reasoned — it does NOT prove the shipped code
 * does what its node claims, which stays with the assumption tests the
 * exclusion deliberately leaves untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { solutionsMissingInstruments } from "../../src/eval/buildable.js";
import {
  auditShippedSolutions,
  namedRepoPaths,
  shippedPromotionLine,
  trustsShippedStatus,
} from "../../src/eval/shipped-audit.js";
import { readVaultPointer } from "../../src/config/pointer.js";
import { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";
const SOLUTION = "Onboarding checklist";
let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-shipped-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-shipped-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * Outcome → Opportunity → Solution → one prose-only AssumptionTest: the exact
 * shape `solutionsMissingInstruments` exists to report, so every exclusion
 * case below starts from a solution that is verifiably IN the queue.
 */
function queuedSolution(body = "x") {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: SOLUTION, layer: "Solution", evidence: "assertion", body, tags: [], links: [] });
  v.createNode({ title: "Checklist audit", layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
  v.linkNodes(OUTCOME, "Users churn after week one");
  v.linkNodes("Users churn after week one", SOLUTION);
  v.linkNodes(SOLUTION, "Checklist audit");
  expect(solutionsMissingInstruments(v.readTree())).toEqual([SOLUTION]);
  return v;
}

describe("a shipped solution leaves the instruments queue — conditionally", () => {
  test("a promotion recorded in History with reasoning leaves the queue", () => {
    const v = queuedSolution();
    v.setStatus(SOLUTION, "shipped", "shipped in v0.1.0; the guard lives at the write funnel");
    expect(trustsShippedStatus(v.read(SOLUTION))).toBe(true);
    expect(solutionsMissingInstruments(v.readTree())).toEqual([]);
  });

  test("a bare status flip with no reasoning stays in the queue", () => {
    const v = queuedSolution();
    v.setStatus(SOLUTION, "shipped");
    // The transition IS in History — but with nothing after it, it is a field
    // change, not evidence, and it must not buy the exclusion.
    expect(v.read(SOLUTION).body).toContain("→ shipped");
    expect(trustsShippedStatus(v.read(SOLUTION))).toBe(false);
    expect(solutionsMissingInstruments(v.readTree())).toEqual([SOLUTION]);
  });

  test("a shipped status written only in frontmatter — no History at all — stays in the queue", () => {
    const v = queuedSolution();
    // The shape a hand edit (or a create-time status) produces: the field says
    // shipped and nothing anywhere says why.
    const file = path.join(dir, `${SOLUTION}.md`);
    const raw = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, raw.replace("type: Solution", "type: Solution\nstatus: shipped"), "utf8");
    expect(v.read(SOLUTION).status).toBe("shipped");
    expect(trustsShippedStatus(v.read(SOLUTION))).toBe(false);
    expect(solutionsMissingInstruments(v.readTree())).toEqual([SOLUTION]);
  });

  test("shipped without the History line is reported by the audit, not silently tolerated", () => {
    const v = queuedSolution();
    const file = path.join(dir, `${SOLUTION}.md`);
    const raw = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, raw.replace("type: Solution", "type: Solution\nstatus: shipped"), "utf8");
    const problems = auditShippedSolutions(v.readTree(), repo);
    expect(problems).toHaveLength(1);
    expect(problems[0].solution).toBe(SOLUTION);
    expect(problems[0].problem).toMatch(/History.*records the promotion/);
  });
});

describe("the audit resolves what a shipped solution names", () => {
  test("a trusted promotion whose named module exists is clean", () => {
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "real.ts"), "// exists\n", "utf8");
    const v = queuedSolution("The guard lives in `src/real.ts` at the write funnel.");
    v.setStatus(SOLUTION, "shipped", "shipped in v0.1.0");
    expect(auditShippedSolutions(v.readTree(), repo)).toEqual([]);
  });

  test("a trusted promotion naming a module that is not there goes red", () => {
    const v = queuedSolution("The guard lives in `src/ghost.ts` at the write funnel.");
    v.setStatus(SOLUTION, "shipped", "shipped in v0.1.0");
    const problems = auditShippedSolutions(v.readTree(), repo);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("src/ghost.ts");
  });

  test("a path named only inside a fenced block is a definition of future work, not audited", () => {
    // Observed on this product's own vault: every unresolvable path a shipped
    // solution carried sat inside a "Definition of done" fence — an instrument
    // command naming the spec a FUTURE build will write. Auditing those would
    // fail every node that honestly declares its follow-on test.
    const body = "Shipped at the funnel.\n\n```\nnpx vitest run test/not-written-yet.test.ts\n```";
    expect(namedRepoPaths(body)).toEqual([]);
    const v = queuedSolution(body);
    v.setStatus(SOLUTION, "shipped", "shipped in v0.1.0");
    expect(auditShippedSolutions(v.readTree(), repo)).toEqual([]);
  });

  test("a .js reference resolves to its .ts source, the way this repo's own imports spell it", () => {
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "real.ts"), "// exists\n", "utf8");
    const v = queuedSolution("Under NodeNext the module is named `src/real.js`.");
    v.setStatus(SOLUTION, "shipped", "shipped in v0.1.0");
    expect(auditShippedSolutions(v.readTree(), repo)).toEqual([]);
  });
});

/**
 * The live half: the vault this repository's committed `ost.vault.yaml` names,
 * audited against this repository. Runs wherever that vault is reachable —
 * the build loop's machine — and skips visibly on a bare clone.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pointer = (() => {
  try {
    return readVaultPointer(REPO_ROOT);
  } catch {
    return null;
  }
})();
const liveVaultDir = pointer && fs.existsSync(pointer.dir) ? pointer.dir : null;

describe.runIf(liveVaultDir !== null)("the live vault this repository points at", () => {
  test("every shipped solution the exclusion trusts survives the audit", () => {
    const tree = new Vault(liveVaultDir!, { create: false }).readTree();
    const trusted = tree.filter((n) => trustsShippedStatus(n)).map((n) => n.title);
    const problems = auditShippedSolutions(tree, REPO_ROOT).filter((p) => trusted.includes(p.solution));
    // One failure here means the queue is hiding a solution whose shipped
    // claim does not check out against the code — fix the vault's record or
    // the status, never this assertion.
    expect(problems).toEqual([]);
  });

  test("an unexplained promotion is never trusted, and the audit names each one", () => {
    const tree = new Vault(liveVaultDir!, { create: false }).readTree();
    for (const n of tree) {
      if (n.layer !== "Solution" || n.status !== "shipped") continue;
      if (shippedPromotionLine(n) === undefined) {
        expect(trustsShippedStatus(n)).toBe(false);
        expect(auditShippedSolutions([n], REPO_ROOT).map((p) => p.solution)).toContain(n.title);
      }
    }
  });
});
