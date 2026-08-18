/**
 * Re-derive the credentialed-step corpus from this machine's Claude Code
 * transcripts of this repository.
 *
 * The fixture at `test/fixtures/credentialed-steps/runs.json` holds the tool-use
 * steps of ten past runs, in order, reduced to what {@link classifyStep} needs
 * (`src/loop/credentialedSteps.ts`) — see that directory's PROVENANCE.md for the
 * cut and the honesty limits on what it does and does not show. This script
 * re-runs the mechanical extraction so the corpus can be checked against the raw
 * transcripts instead of trusted:
 *
 *   npx tsx scripts/harvest-credentialed-steps.ts ~/.claude/projects/-Users-tanner-dev-OST-Agent
 *
 * The cut: the ten most recently modified transcripts in that directory, as of
 * 2026-08-18, carrying at least ten tool_use steps — trivial sessions (a stray
 * click-through, a session that never left planning) are not "a run" in the
 * sense the assumption test means.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";

/** The ten sessions this repo's own history held on 2026-08-18 — see PROVENANCE.md. */
const CANDIDATES = [
  "f5b356df-1d36-4367-a6e7-668a50e081b3",
  "f48dc76d-9bb6-45c3-b624-5b386609d720",
  "d1f1dace-62db-4cd4-b0a6-4ab29a5ff4d0",
  "e2688697-1ac0-4e8f-a8e8-f3367a7cdd1d",
  "89ee644b-3432-497e-adc8-41872d0c43e1",
  "bf39241c-e274-4faf-956a-fda8d59d94bf",
  "7a5dad85-500f-43d1-a6af-c20d2ad049cd",
  "9b7615cf-6d1c-43d4-a2ee-c2bbcf281233",
  "9a29042a-10cd-48c6-b8c6-bebc0ea76a1b",
  "5eb7d27f-dc81-423b-aaa8-939b75580344",
];

interface RunStep {
  tool: string;
  command?: string;
}

/** One line of a command, redacted, whitespace-collapsed, and capped — enough to
 * classify, never enough to be the operator's whole day. */
function reduceCommand(cmd: string): string {
  const flat = redactSecrets(cmd).replace(/\s+/g, " ").trim();
  return flat.slice(0, 400);
}

function readSteps(file: string): RunStep[] {
  const steps: RunStep[] = [];
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const content = (entry.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== "tool_use") continue;
      const tool = String(block.name ?? "");
      const step: RunStep = { tool };
      if (tool === "Bash") {
        const command = (block.input as Record<string, unknown> | undefined)?.command;
        step.command = reduceCommand(typeof command === "string" ? command : "");
      }
      steps.push(step);
    }
  }
  return steps;
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/harvest-credentialed-steps.ts <transcript-dir>");
  process.exit(1);
}

const runs = CANDIDATES.map((id, i) => {
  const file = path.join(dir, `${id}.jsonl`);
  if (!fs.existsSync(file)) {
    console.error(`missing transcript: ${file}`);
    return null;
  }
  return { run: `run-${String(i + 1).padStart(2, "0")}`, steps: readSteps(file) };
}).filter((r): r is { run: string; steps: RunStep[] } => r !== null);

console.error(
  `${runs.length} run(s) harvested, ${runs.reduce((n, r) => n + r.steps.length, 0)} step(s) total`,
);
console.log(JSON.stringify({ runs }, null, 2));
