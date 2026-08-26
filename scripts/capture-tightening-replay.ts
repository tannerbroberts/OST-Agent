/**
 * Capture what actually happened to the tree after each of the last three
 * tightenings, as a fixture `test/ost/grandfathered-backlog-replay.test.ts`
 * replays offline.
 *
 * The assumption test underneath "New rules apply forward only, and existing
 * nodes are marked as predating them" is a question about history, not about
 * code: *did* a would-be-grandfathered backlog ever clear? History lives in the
 * meta vault's git log, which is one operator's working directory — not
 * something a committed test may read. So the reading is taken once, here, and
 * what gets committed is the observation. The test computes the clearance rate
 * and applies the threshold; this script only records what the vault said on
 * each day.
 *
 * Run it against a vault checkout:
 *
 *   npx tsx scripts/capture-tightening-replay.ts /path/to/vault
 *
 * Every number it writes is re-derivable: each day's row names the vault commit
 * it was read from, so a reader with the same repository can check any of them
 * with `git archive <sha>` and `ost-agent check`.
 *
 * **The one place this is weaker than it reads.** Violations are computed with
 * *today's* `checkInvariants`, not the version that shipped on each day. That is
 * deliberate — the question is how many nodes the rule as it now stands would
 * have caught — but it means a row before a rule's `inForceFrom` shows a count
 * for a rule that was not yet enforcing anything. Those rows are the point: they
 * are the backlog accumulating with no pressure on it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkInvariants } from "../src/eval/invariants.js";
import { CLEARANCE_WINDOW_DAYS, lastTightenings, shiftDays } from "../src/eval/rule-inception.js";
import { Vault } from "../src/ost/vault.js";
import type { TighteningReplay } from "../src/eval/grandfathered.js";

/** How many days before a tightening to record, so the no-pressure trajectory is visible. */
const LEAD_IN_DAYS = 12;

/** End-of-day in the timezone the vault's commits are stamped in. */
const DAY_END = "T23:59:59-05:00";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "tightening-replay.json");

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
}

/** The vault as it stood at `sha`, extracted to a temp dir the caller removes. */
function snapshot(repo: string, sha: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-replay-"));
  const tar = path.join(dir, "snap.tar");
  fs.writeFileSync(tar, execFileSync("git", ["-C", repo, "archive", sha], { maxBuffer: 1 << 30 }));
  fs.mkdirSync(path.join(dir, "v"));
  execFileSync("tar", ["-xf", tar, "-C", path.join(dir, "v")]);
  return dir;
}

function main(): void {
  const repo = process.argv[2];
  if (!repo) throw new Error("usage: capture-tightening-replay.ts <vault-repo>");

  const tightenings = lastTightenings(3);
  const capturedAt = git(repo, "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d");
  const earliest = tightenings.map((t) => shiftDays(t.inForceFrom, -LEAD_IN_DAYS)).sort()[0];
  const latest = tightenings.map((t) => shiftDays(t.inForceFrom, CLEARANCE_WINDOW_DAYS)).sort().at(-1)!;

  // One snapshot per day, reused across all three rules — extracting 1,400 files
  // is the expensive part and doing it once per rule triples it for nothing.
  const days: string[] = [];
  for (let d = earliest; d <= capturedAt && d <= latest; d = shiftDays(d, 1)) days.push(d);

  /** date -> rule -> offending node titles, plus each node's `created`. */
  const offendersByDay = new Map<string, Map<string, string[]>>();
  const createdByDay = new Map<string, Map<string, string | undefined>>();
  const shaByDay = new Map<string, string>();
  const sizeByDay = new Map<string, number>();

  for (const day of days) {
    const sha = git(repo, "rev-list", "-1", `--before=${day}${DAY_END}`, "HEAD");
    if (!sha) continue;
    const dir = snapshot(repo, sha);
    try {
      const nodes = new Vault(path.join(dir, "v")).readTree();
      const byRule = new Map<string, string[]>();
      for (const v of checkInvariants(nodes)) {
        if (!v.node) continue;
        const seen = byRule.get(v.rule);
        if (seen) {
          if (!seen.includes(v.node)) seen.push(v.node);
        } else byRule.set(v.rule, [v.node]);
      }
      offendersByDay.set(day, byRule);
      createdByDay.set(day, new Map(nodes.map((n) => [n.title, n.created])));
      shaByDay.set(day, sha);
      sizeByDay.set(day, nodes.length);
      process.stderr.write(`${day} ${sha.slice(0, 8)} ${nodes.length} node(s)\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const replays: TighteningReplay[] = [];
  for (const t of tightenings) {
    const eve = days.filter((d) => d < t.inForceFrom && shaByDay.has(d)).at(-1);
    if (!eve) throw new Error(`no vault history before ${t.rule} landed on ${t.inForceFrom}`);
    const eveOffenders = offendersByDay.get(eve)?.get(t.rule) ?? [];
    const eveCreated = createdByDay.get(eve)!;

    const after = days.filter((d) => d >= t.inForceFrom && shaByDay.has(d));
    const nodes = [];
    let boundAtInception = 0;
    for (const title of eveOffenders) {
      const created = eveCreated.get(title);
      // Strictly before, so a node stamped the day of the tightening is bound —
      // the tie goes to the rule (see rule-inception.ts). A node with no
      // `created` at all is treated as predating and flagged so the replay can
      // report it separately.
      if (created !== undefined && created >= t.inForceFrom) {
        boundAtInception += 1;
        continue;
      }
      let clearedOn: string | null = null;
      let resolution: "compliant" | "absent" | null = null;
      for (const day of after) {
        const stillOffending = offendersByDay.get(day)!.get(t.rule)?.includes(title) ?? false;
        if (stillOffending) continue;
        clearedOn = day;
        resolution = createdByDay.get(day)!.has(title) ? "compliant" : "absent";
        break;
      }
      nodes.push({ node: title, created: created ?? null, clearedOn, resolution });
    }

    replays.push({
      rule: t.rule,
      inForceFrom: t.inForceFrom,
      commit: t.commit,
      eve: { date: eve, vaultCommit: shaByDay.get(eve)!, nodes: sizeByDay.get(eve)! },
      boundAtInception,
      nodes,
      daily: days
        .filter((d) => shaByDay.has(d))
        .map((d) => ({
          date: d,
          vaultCommit: shaByDay.get(d)!.slice(0, 8),
          nodes: sizeByDay.get(d)!,
          offenders: (offendersByDay.get(d)!.get(t.rule) ?? []).length,
        })),
    });
  }

  const record = {
    capturedAt,
    vault: { head: git(repo, "rev-parse", "HEAD"), firstCommit: git(repo, "rev-list", "--max-parents=0", "HEAD") },
    clearanceWindowDays: CLEARANCE_WINDOW_DAYS,
    tightenings: replays,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(`wrote ${OUT}\n`);
}

main();
