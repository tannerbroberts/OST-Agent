/**
 * Re-derive the mechanical half of the blocked-run corpus from this machine's
 * Claude Code transcripts.
 *
 * The fixture at `test/fixtures/blocked-runs/runs.json` holds ten runs that
 * filed `ost_flag_humans_required` and then kept going. Its fields (session,
 * entry, the block's test/why, the outstanding-work titles) are read verbatim
 * out of the raw transcript — nothing here is paraphrased. This script re-runs
 * that mechanical cut so the corpus can be checked against the raw
 * transcripts instead of trusted:
 *
 *   npx tsx scripts/harvest-blocked-runs.ts ~/.claude/projects/-Users-tanner-ost-agent-meta
 *
 * The cut, in order:
 *   1. candidate sessions are every transcript the meta vault held a
 *      TRANSCRIPT: evidence record for that also mentions a block filing, as
 *      of 2026-08-16 (the list below);
 *   2. a session is dropped if it never actually calls
 *      `mcp__ost-agent__ost_flag_humans_required` (the vault record can
 *      mention "BLOCKED" from a refused permission line without the call
 *      landing);
 *   3. a session is dropped if the FIRST block it files has no work-tool call
 *      after it at all — a run that stopped dead has no outstanding work to
 *      partition, independent or not;
 *   4. of what remains, the ten sessions with the most transcript entries are
 *      kept, so the corpus favours runs with enough afterward to be worth
 *      walking rather than a coin flip on one or two items.
 *
 * "Outstanding work" is read mechanically, not authored: every call to one of
 * the five node-mutating MCP tools after the first block, keyed by the node
 * title it names, first occurrence kept. Read-only calls (Read, Grep, Glob,
 * ost_check/status/debt/next_work/ingest_inbox) are not work items — they are
 * how the run decided what to do, not a thing it did.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";

const CANDIDATES = [
  "030e5db3-9414-441f-9221-b4a984c11825",
  "03a79a59-682a-4528-83c6-4c39d8c658ef",
  "21d0f730-05c0-4cf8-8cd2-ecdea5444bba",
  "28d14def-76a2-4bbb-bd55-6f9b80c8ca8c",
  "3b9eaea5-d098-4f47-ad0a-65871012d639",
  "467b3b38-9ed7-490f-8915-7c7a7b12ff13",
  "491c205c-aadc-4c19-9644-a38a0c9c3be6",
  "49d6b2d3-b867-4996-9d9d-8f10dd0871de",
  "6308a576-c305-4d14-aef9-d0f71f8a1aaa",
  "6e66c934-24d8-4200-b6f2-7af23002c478",
  "7449e571-40b5-47b6-a1cd-3b2c1c85322e",
  "868a30f5-6431-4779-aca6-6e2926a9d4a4",
  "8a9777ad-a1ca-47fc-ab8e-3bd4b001a5cd",
  "9aa6b7c9-a6a9-41f9-892b-4a330a99cc36",
  "b0ad16bf-d234-4d46-bf7f-5e1deaad8b78",
  "b772518b-88b5-4fae-8c6a-aa9df819a27a",
  "babb0438-8efa-4f3c-8d00-44d46be36cae",
  "f9f63ce3-eb2e-4a7a-855b-e1d4948828fa",
  "fe05964f-a644-4aeb-af57-3a37bde1f137",
];

/** Node-mutating tools whose input names the node they act on. */
const WORK_TOOLS: Record<string, string> = {
  "mcp__ost-agent__ost_set_instrument": "test",
  "mcp__ost-agent__ost_append_to_node": "title",
  "mcp__ost-agent__ost_create_node": "title",
  "mcp__ost-agent__ost_annotate": "title",
  "mcp__ost-agent__ost_set_status": "title",
};

interface BlockedRun {
  session: string;
  entries: number;
  blockedAtEntry: number;
  blockedAt: string;
  test: string;
  why: string;
  outstanding: string[];
}

function readRun(file: string): BlockedRun | null {
  const session = path.basename(file, ".jsonl");
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  let blockIdx = -1;
  let test = "";
  let why = "";
  let blockedAt = "";
  for (let i = 0; i < parsed.length; i++) {
    const content = (parsed[i]?.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_use" && block.name === "mcp__ost-agent__ost_flag_humans_required") {
        const input = block.input as { test?: string; why?: string };
        blockIdx = i;
        test = input.test ?? "";
        why = input.why ?? "";
        blockedAt = typeof parsed[i]?.timestamp === "string" ? (parsed[i]!.timestamp as string) : "";
        break;
      }
    }
    if (blockIdx >= 0) break;
  }
  if (blockIdx < 0) return null;

  const outstanding: string[] = [];
  const seen = new Set<string>();
  for (let i = blockIdx + 1; i < parsed.length; i++) {
    const content = (parsed[i]?.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== "tool_use") continue;
      const field = WORK_TOOLS[block.name as string];
      if (!field) continue;
      const input = block.input as Record<string, unknown>;
      const title = typeof input[field] === "string" ? (input[field] as string) : "";
      if (!title || seen.has(title)) continue;
      seen.add(title);
      outstanding.push(redactSecrets(title));
    }
  }
  if (outstanding.length === 0) return null;

  return {
    session,
    entries: parsed.length,
    blockedAtEntry: blockIdx,
    blockedAt,
    test: redactSecrets(test),
    why: redactSecrets(why),
    outstanding,
  };
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/harvest-blocked-runs.ts <transcript-dir>");
  process.exit(1);
}

const runs: BlockedRun[] = [];
for (const id of CANDIDATES) {
  const file = path.join(dir, `${id}.jsonl`);
  if (!fs.existsSync(file)) {
    console.error(`missing transcript: ${file}`);
    continue;
  }
  const run = readRun(file);
  if (run) runs.push(run);
}

runs.sort((a, b) => b.entries - a.entries);
const kept = runs.slice(0, 10).sort((a, b) => a.blockedAt.localeCompare(b.blockedAt));

console.error(
  `${kept.length} run(s) kept of ${runs.length} candidate(s) with outstanding work ` +
    `(${CANDIDATES.length - runs.length} dropped: no block filed or nothing after it)`,
);
console.log(JSON.stringify({ runs: kept }, null, 2));
