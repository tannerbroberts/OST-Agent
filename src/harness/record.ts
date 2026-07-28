/**
 * Where fitness records live: `.ost-agent/harness/runs.jsonl`, append-only.
 *
 * A sidecar rather than the tree, deliberately. `hasRecordedResult` clears on
 * `status === "validated"` OR a literal `## Results` heading, and both are
 * reachable from the tool allowlist via `ost_set_status` and
 * `ost_append_to_node` — so a tree-native fitness record would let a refereed
 * run mark its own benchmark recorded. That is the category error the whole
 * design is built to avoid. Tree-native selection is Phase 4 work, written
 * through the human/CLI path that is deliberately off the MCP surface.
 *
 * `harness/` and not the existing `.ost-agent/runs/`: that directory is
 * scaffolded by `init` and read or written by NOTHING in the repo. Writing
 * there would look like joining a convention with no code on the other side.
 * Lazy creation on first write is the established pattern — `usage/`,
 * `attention/` and `trust/` are all created on demand, none by `init`.
 *
 * LOSERS ARE RETAINED. A tournament that keeps only winners destroys its own
 * dataset: variance decomposition runs on the failures, and an inert gene is
 * discoverable only from the variants that carried it and lost. So nothing here
 * filters, and nothing rewrites.
 */
import fs from "node:fs";
import path from "node:path";
import type { FitnessRecord } from "./fitness.js";

export const HARNESS_LOG = "runs.jsonl";

export function harnessLogPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "harness", HARNESS_LOG);
}

/**
 * Append one fitness record. Never throws — a lost record costs a data point,
 * never a population run. Same contract as `recordAttention` and
 * `recordUsageEvent`.
 */
export function recordRun(vaultDir: string, record: FitnessRecord): void {
  try {
    const file = harnessLogPath(vaultDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // fail-open by contract
  }
}

/** Every record, in write order. A missing log reads as no runs; a corrupt line is skipped. */
export function readRuns(vaultDir: string): FitnessRecord[] {
  try {
    const raw = fs.readFileSync(harnessLogPath(vaultDir), "utf8");
    const out: FitnessRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as FitnessRecord);
      } catch {
        // One bad line must not cost the whole ledger.
      }
    }
    return out;
  } catch {
    return [];
  }
}
