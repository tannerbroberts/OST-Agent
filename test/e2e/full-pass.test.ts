import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { runPass } from "../../src/runner/pass.js";
import { scriptedDriver, type ScriptedCall } from "../../src/runner/driver.js";
import { getProcess } from "../../src/processes/registry.js";
import { byTitle } from "../../src/processes/tree.js";

let dir: string;
const OUTCOME = "Reach 10,000 daily active users";
const OPP = "I want a reason to come back every day";
const SOL = "Daily challenge mode";
const ASM = "A daily ritual will lift retention";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-e2e-"));
  await initVault(dir, OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function commitCount(): number {
  return Number(execSync("git rev-list --count HEAD", { cwd: dir }).toString().trim());
}
function countFiles(root: string): number {
  let n = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) n += countFiles(full);
    else n++;
  }
  return n;
}

const scripts: Record<string, ScriptedCall[]> = {
  // create attaches to the parent atomically — no separate link step
  P2_map: [
    { tool: "ost_create_node", input: { title: OPP, layer: "Opportunity", parent: OUTCOME, source: "INBOX:interview.md", body: "Players want a daily reason to return." } },
  ],
  P3_ideate: [
    { tool: "ost_create_node", input: { title: SOL, layer: "Solution", parent: OPP, status: "unvalidated", tags: ["unvalidated"], body: "A seeded daily puzzle shared by all players." } },
  ],
  P4_assumptions: [
    { tool: "ost_create_node", input: { title: ASM, layer: "AssumptionTest", parent: SOL, status: "unvalidated", tags: ["unvalidated"], body: "Propose: compare D1 retention for cohorts with vs without a daily challenge." } },
  ],
};

async function run(id: string) {
  return runPass(getProcess(id)!, buildPassContext(dir), scriptedDriver(scripts));
}

describe("end-to-end inbox → tree", () => {
  test("a dropped note becomes a committed, Obsidian-valid, append-only tree", async () => {
    const startCommits = commitCount();
    expect(startCommits).toBeGreaterThanOrEqual(1); // init committed the outcome

    // drop two inbox notes (into the configured inbox path — now under .ost-agent)
    const inboxDir = path.join(dir, buildPassContext(dir).config.adapters.inbox.path);
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, "interview.md"), "User: I keep opening the app hoping for something new each day.");
    fs.writeFileSync(path.join(inboxDir, "decision.md"), "We agreed retention is the priority outcome this quarter.");

    // P1 ingest (deterministic) — captures evidence, advances cursor
    const ingest = await run("P1_ingest");
    expect(ingest.result.evidence).toBe(2);

    // re-run ingest — cursor prevents re-ingestion
    const ingest2 = await run("P1_ingest");
    expect(ingest2.result.evidence).toBe(0);

    const filesBeforePipeline = countFiles(dir);
    const commitsBeforePipeline = commitCount();

    // P2 → P3 → P4 → P5
    await run("P2_map");
    await run("P3_ideate");
    await run("P4_assumptions");
    const hygiene = await run("P5_hygiene");
    expect(hygiene.result.annotated).toBe(0); // well-formed tree — nothing to flag

    // ── tree shape ──
    const tree = buildPassContext(dir).vault.readTree();
    const index = byTitle(tree);
    const byLayer = (l: string) => tree.filter((n) => n.layer === l);
    expect(byLayer("Outcome")).toHaveLength(1);
    expect(byLayer("Opportunity").length).toBeGreaterThanOrEqual(1);
    expect(byLayer("Solution").length).toBeGreaterThanOrEqual(1);
    expect(byLayer("AssumptionTest").length).toBeGreaterThanOrEqual(1);

    // outcome links the opportunity; opportunity links the solution; solution links the assumption
    expect(index.get(OUTCOME)!.links).toContain(OPP);
    expect(index.get(OPP)!.links).toContain(SOL);
    expect(index.get(SOL)!.links).toContain(ASM);

    // ideated nodes are unvalidated (never asserted as validated)
    expect(index.get(SOL)!.status).toBe("unvalidated");
    expect(index.get(SOL)!.tags).toContain("unvalidated");
    expect(index.get(ASM)!.status).toBe("unvalidated");

    // ── Obsidian validity: every wikilink resolves to a real node ──
    for (const n of tree) {
      for (const link of n.links) {
        expect(index.has(link), `dangling link [[${link}]] in "${n.title}"`).toBe(true);
      }
    }

    // ── append-only: files and commits only grew; nothing deleted ──
    expect(countFiles(dir)).toBeGreaterThan(filesBeforePipeline);
    expect(commitCount()).toBeGreaterThan(commitsBeforePipeline);

    // git history was never rewritten — the very first commit is still an ancestor of HEAD
    const first = (await simpleGit(dir).raw(["rev-list", "--max-parents=0", "HEAD"])).trim();
    const isAncestor = await simpleGit(dir)
      .raw(["merge-base", "--is-ancestor", first, "HEAD"])
      .then(() => true)
      .catch(() => false);
    expect(isAncestor).toBe(true);
  });
});
