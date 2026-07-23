#!/usr/bin/env node
/**
 * `npm run eval` — the holistic efficacy check (dogfooding OST-Agent on itself).
 *
 * Spins up a throwaway vault from eval/corpus (real evidence about OST-Agent),
 * runs the REAL agent (P1→P5) to produce a tree, then runs the INDEPENDENT judge
 * and prints the scorecard. Needs Anthropic credentials — this is the one part
 * that cannot be verified without the model.
 *
 *   npm run eval                 # temp vault, discarded after
 *   npm run eval -- --out ./discovery   # keep the produced tree to inspect
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initVault } from "../runner/init.js";
import { buildPassContext } from "../runner/context.js";
import { runPass } from "../runner/pass.js";
import { anthropicDriver } from "../runner/driver.js";
import { getProcess } from "../processes/registry.js";
import { readEvidence } from "../processes/tree.js";
import { anthropicJudge } from "./judge.js";
import { formatScorecard, score } from "./scorecard.js";

async function main() {
  const evalDir = path.resolve(process.cwd(), "eval");
  const outcome = fs.readFileSync(path.join(evalDir, "outcome.txt"), "utf8").trim();
  const corpusDir = path.join(evalDir, "corpus");
  const corpus = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".md"));

  const outArg = process.argv.indexOf("--out");
  const workdir = outArg !== -1 ? path.resolve(process.argv[outArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "ost-eval-"));

  console.log(`Outcome: ${outcome}`);
  console.log(`Corpus:  ${corpus.length} evidence files`);
  console.log(`Vault:   ${workdir}\n`);

  await initVault(workdir, outcome);
  for (const f of corpus) fs.copyFileSync(path.join(corpusDir, f), path.join(workdir, "inbox", f));

  for (const id of ["P1_ingest", "P2_map", "P3_ideate", "P4_assumptions", "P5_hygiene"]) {
    const proc = getProcess(id)!;
    const r = await runPass(proc, buildPassContext(workdir), anthropicDriver());
    console.log(`  ${id}: created=${r.result.created} linked=${r.result.linked} evidence=${r.result.evidence}${r.error ? ` error=${r.error}` : ""}`);
  }

  const ctx = buildPassContext(workdir);
  const tree = ctx.vault.readTree();
  const evidence = readEvidence(workdir);

  console.log(`\nProduced ${tree.length} nodes. Judging faithfulness (independent pass)…\n`);
  const report = await anthropicJudge(ctx.config.model)({ outcome, evidence, tree });
  const scorecard = score(tree, report);

  console.log(formatScorecard(scorecard));
  console.log(`\nInspect the tree:  ${workdir}`);
  process.exitCode = scorecard.pass ? 0 : 1;
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/api key|authentication|ANTHROPIC/i.test(msg)) {
    console.error("The efficacy run needs Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`).");
  } else {
    console.error(msg);
  }
  process.exitCode = 1;
});
