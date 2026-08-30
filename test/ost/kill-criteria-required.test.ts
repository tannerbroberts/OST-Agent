/**
 * Pre-committed kill criteria attached to every candidate at birth.
 *
 * The assumption under test is "a written criterion is actually honoured", and
 * this file cannot settle that — honouring one takes two weeks of calendar and a
 * person willing to act on a list. What it pins is the half a repository can
 * hold: the criteria EXIST and are EVALUABLE. Three claims, in the words of the
 * node that commissioned it:
 *
 *   1. a Solution cannot be created without a condition and a date;
 *   2. both are stored as FIELDS rather than buried in prose, so something other
 *      than a reader can find them;
 *   3. the sweep lists every candidate whose date has passed with its condition
 *      unmet.
 *
 * Green here does not mean anything gets killed. It means nothing can be born
 * un-killable any more, and that the list a person would act on can be printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import {
  formatKillCriteriaCensus,
  killCriteriaCensus,
  readKillCriteria,
  type KillCriteriaCensus,
} from "../../src/ost/kill-criteria.js";
import { deserialize, type OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  vault.createNode({ tags: [], links: [], evidence: "assertion", body: `prose for ${node.title}`, ...node } as OstNode);
}

/** A YYYY-MM-DD `days` from `from`, so a test can name a date without hard-coding one. */
function dayOffset(from: string, days: number): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const today = (): string => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-kill-criteria-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:kill-criteria" };
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: OPPORTUNITY, layer: "Opportunity" });
  vault.linkNodes(OUTCOME, OPPORTUNITY);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const create = (input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

const SOLUTION = {
  title: "A changelog in the client",
  layer: "Solution",
  parent: OPPORTUNITY,
  body: "show what changed since the player last played",
  evidence: "assertion",
} as const;

const files = (): string[] => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());

describe("a Solution cannot be born without kill criteria", () => {
  test("a criteria-free Solution is refused, and nothing is written", async () => {
    const before = files();

    await expect(create({ ...SOLUTION })).rejects.toThrow(/needs `killIf`/);

    // Every other create-node guard refuses before the first byte; this one too.
    expect(files()).toEqual(before);
    expect(new Vault(dir).has(SOLUTION.title)).toBe(false);
  });

  test("a condition with no date is refused — a criterion that never comes up settles nothing", async () => {
    await expect(create({ ...SOLUTION, killIf: "no player opens it twice in a fortnight" })).rejects.toThrow(
      /needs `killBy`/,
    );
  });

  test("a date with no condition is refused — a date settles nothing on its own", async () => {
    await expect(create({ ...SOLUTION, killBy: dayOffset(today(), 14) })).rejects.toThrow(/needs `killIf`/);
  });

  test("a condition that only schedules the decision is refused", async () => {
    await expect(
      create({ ...SOLUTION, killIf: "decide whether the changelog is worth keeping", killBy: dayOffset(today(), 14) }),
    ).rejects.toThrow(/needs `killIf`/);
  });

  test("a placeholder condition is refused", async () => {
    await expect(create({ ...SOLUTION, killIf: "TBD", killBy: dayOffset(today(), 14) })).rejects.toThrow(/needs `killIf`/);
  });

  test("a date already gone is refused — the criterion would be met at birth", async () => {
    await expect(
      create({ ...SOLUTION, killIf: "no player opens it twice in a fortnight", killBy: dayOffset(today(), -1) }),
    ).rejects.toThrow(/needs `killBy`/);
  });

  test("a date past the horizon is refused — no sweep would ever reach it", async () => {
    await expect(
      create({ ...SOLUTION, killIf: "no player opens it twice in a fortnight", killBy: dayOffset(today(), 4000) }),
    ).rejects.toThrow(/needs `killBy`/);
  });

  test("a date that is not a calendar date is refused", async () => {
    await expect(
      create({ ...SOLUTION, killIf: "no player opens it twice in a fortnight", killBy: "in a fortnight" }),
    ).rejects.toThrow(/needs `killBy`/);
  });

  test("the fields are refused on any other layer — an opportunity is answered, not killed", async () => {
    await expect(
      create({
        title: "Players want less noise",
        layer: "Opportunity",
        parent: OUTCOME,
        body: "a need",
        evidence: "assertion",
        killIf: "nobody says it again",
        killBy: dayOffset(today(), 14),
      }),
    ).rejects.toThrow(/killIf is only meaningful for a Solution/);
  });
});

describe("the criteria are stored as fields, not buried in prose", () => {
  test("a Solution born with both halves carries them in frontmatter and reads back", async () => {
    const by = dayOffset(today(), 14);
    await create({ ...SOLUTION, killIf: "no player opens it twice in a fortnight", killBy: by });

    const raw = fs.readFileSync(path.join(dir, `${SOLUTION.title}.md`), "utf8");
    // The whole point of a field: something other than a human can find it. The
    // frontmatter block is asserted directly, because "it is in the file
    // somewhere" is exactly what prose already was.
    const frontmatter = raw.slice(0, raw.indexOf("\n---", 4));
    expect(frontmatter).toMatch(/^killIf: .*no player opens it twice in a fortnight/m);
    expect(frontmatter).toMatch(new RegExp(`^killBy: '?${by}'?$`, "m"));

    const written = new Vault(dir).read(SOLUTION.title);
    expect(written.killIf).toBe("no player opens it twice in a fortnight");
    expect(written.killBy).toBe(by);
    expect(readKillCriteria(written)).toEqual({ condition: "no player opens it twice in a fortnight", by });
    // And round-trips through the parser the rest of the product reads with.
    expect(deserialize(SOLUTION.title, raw).killBy).toBe(by);
  });
});

describe("the sweep lists every candidate whose date has passed with its condition unmet", () => {
  const NOW = "2026-09-01";

  function sweep(): KillCriteriaCensus {
    return killCriteriaCensus(new Vault(dir).readTreeCensus(), NOW);
  }

  beforeEach(() => {
    const solution = (title: string, extra: Partial<OstNode>): void => {
      put({ title, layer: "Solution", ...extra });
      vault.linkNodes(OPPORTUNITY, title);
    };
    solution("Overdue by a fortnight", { killIf: "no player opens it twice in a fortnight", killBy: "2026-08-18" });
    solution("Overdue by a day", { killIf: "no operator has read it", killBy: "2026-08-31" });
    solution("Due tomorrow", { killIf: "nobody has asked for it", killBy: "2026-09-02" });
    solution("Already killed", { killIf: "no player opens it", killBy: "2026-08-01", status: "deferred" });
    solution("Written before the field existed", {});
  });

  test("every overdue live candidate is listed, most overdue first, with its condition", () => {
    const census = sweep();

    expect(census.overdue.map((o) => o.title)).toEqual(["Overdue by a fortnight", "Overdue by a day"]);
    expect(census.overdue[0]).toMatchObject({
      by: "2026-08-18",
      daysOverdue: 14,
      condition: "no player opens it twice in a fortnight",
    });
    expect(census.overdue[1].daysOverdue).toBe(1);
  });

  test("a candidate whose date has not come is not on the list, and one already killed leaves it", () => {
    const census = sweep();

    expect(census.overdue.map((o) => o.title)).not.toContain("Due tomorrow");
    expect(census.overdue.map((o) => o.title)).not.toContain("Already killed");
    // Named rather than silently absent: "0 overdue" over a tree where
    // everything was deferred is a different fact from one where it is live.
    expect(census.retired).toContain("Already killed");
  });

  test("a solution written before the field existed is named, never counted as compliant", () => {
    const census = sweep();

    expect(census.unlabelled).toEqual(["Written before the field existed"]);
    expect(census.carrying).toBe(3);
    expect(census.live).toBe(4);
    expect(census.candidates).toBe(5);
  });

  test("the sweep states what it read, so an empty list cannot mean nobody looked", () => {
    const census = sweep();

    expect(census.subject.read).toBeGreaterThan(0);
    expect(census.blindness).toBe("full");
    expect(formatKillCriteriaCensus(census)).toContain("2 candidate(s) overdue");
    expect(formatKillCriteriaCensus(census)).toContain("no player opens it twice in a fortnight");
  });

  test("kill fields present and unreadable are reported, not read as 'no date is due'", () => {
    put({ title: "A date nothing can parse", layer: "Solution", killIf: "nobody asks", killBy: "next quarter" });
    vault.linkNodes(OPPORTUNITY, "A date nothing can parse");

    const census = sweep();

    expect(census.malformed.map((m) => m.title)).toEqual(["A date nothing can parse"]);
    expect(census.unlabelled).not.toContain("A date nothing can parse");
  });
});
