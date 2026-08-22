/**
 * `ost-agent review-sample` — the drawing half of "rate a tenth, act on the read".
 *
 * The solution this pins ("Human review sampling with a faithfulness rubric") is
 * a human method, and the estimate it proposes stays human: whether a 10% sample
 * tracks the whole tree is settled by a person rating both. **But before a sample
 * can estimate anything it has to be a sample**, and that half is code, and this
 * file is where it goes red. Three properties, each of which a plausible-looking
 * implementation gets wrong:
 *
 *   - **It is a tenth of the tree, not the head of it.** `ls | head -n` is the
 *     draw that always looks fine and always reviews the letter A. The fixture
 *     below is built so the alphabetical head misses two of its three buckets
 *     entirely, and the test asserts on that difference rather than on "is
 *     stratified" as an adjective.
 *   - **Every bucket and every layer is represented.** Not as two independent
 *     margins — each `bucket × layer` cell that holds a node contributes one.
 *   - **The same seed draws the same set, a different seed does not.** Two
 *     reviewers rating "the sample" have to be rating the same nodes.
 *
 * The CLI is spawned rather than the module called, because the seed default and
 * the frame both live in the command: a module test would pass over a draw the
 * operator can never reproduce.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";
import type { Layer } from "../../src/ost/node.js";

// The local tsx binary, invoked directly rather than through `npx` — see the note
// in `lanes.test.ts`: `npx` takes npm's cacache lock and concurrent spawns wedge.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

let dir: string;

/**
 * Three buckets whose node titles sort into three disjoint alphabetical blocks.
 *
 * That is the whole point of the prefixes: any head-of-the-list draw of fewer
 * than 21 nodes returns `aaa-*` and nothing else, so "did it stratify" becomes a
 * question about which buckets are on the sheet rather than a question about
 * intent.
 */
const BUCKETS = [
  { title: "Aardvark bucket", prefix: "aaa" },
  { title: "Meerkat bucket", prefix: "mmm" },
  { title: "Zebra bucket", prefix: "zzz" },
] as const;

/** Per bucket, beyond the bucket Opportunity itself. 20 reviewable nodes each. */
const SHAPE: ReadonlyArray<{ layer: Layer; count: number }> = [
  { layer: "Opportunity", count: 3 },
  { layer: "Solution", count: 6 },
  { layer: "Assumption", count: 4 },
  { layer: "AssumptionTest", count: 6 },
];

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

/** stdout of one draw, memoised so the suite spawns the CLI once per argument set. */
const draws = new Map<string, string>();
async function draw(args: string[]): Promise<string> {
  const k = args.join(" ");
  const hit = draws.get(k);
  if (hit !== undefined) return hit;
  const { stdout } = await cli(["review-sample", "--vault", dir, ...args]);
  draws.set(k, stdout);
  return stdout;
}

/** The titles on a sheet, read back off the checkbox lines. */
function sheetTitles(stdout: string): string[] {
  return [...stdout.matchAll(/^ {4}\[ \] grounded {2}\[ \] classified {2}\[ \] useful {2}(.+)$/gm)].map((m) => m[1]);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-review-sample-"));
  await initVault(dir, "Ship a tree somebody outside this room would act on");
  const vault = new Vault(dir);
  const root = vault.readTree().find((n) => n.layer === "Outcome")!.title;

  for (const bucket of BUCKETS) {
    vault.createNode({ title: bucket.title, layer: "Opportunity", tags: [], links: [], body: "b", evidence: "stated" });
    vault.linkNodes(root, bucket.title);
    for (const { layer, count } of SHAPE) {
      for (let i = 1; i <= count; i++) {
        const title = `${bucket.prefix} ${layer.toLowerCase()} ${String(i).padStart(2, "0")}`;
        vault.createNode({
          title,
          layer,
          tags: [],
          links: [],
          body: "b",
          evidence: "assertion",
          source: `INBOX:${bucket.prefix}.md`,
        });
        vault.linkNodes(bucket.title, title);
      }
    }
  }

  // A node two buckets reach. The rollup counts it under both on purpose; a
  // sample cannot, or the sheet asks somebody to rate it twice.
  vault.createNode({
    title: "shared solution both ends of the alphabet link",
    layer: "Solution",
    tags: [],
    links: [],
    body: "b",
    evidence: "assertion",
  });
  vault.linkNodes("Aardvark bucket", "shared solution both ends of the alphabet link");
  vault.linkNodes("Zebra bucket", "shared solution both ends of the alphabet link");

  // In no bucket at all — exactly what `rollup` reports as unfiled, and the
  // population a tidier frame drops.
  vault.createNode({ title: "orphan opportunity nobody filed", layer: "Opportunity", tags: [], links: [], body: "b" });

  // Enumerated, and unparseable. Outside the frame, and it has to be said so.
  fs.writeFileSync(path.join(dir, "half-written node.md"), "---\ntype: [Solution\n---\n#Solution\n", "utf8");
}, 120_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the draw is a tenth of the tree", () => {
  test("draws about 10% of the reviewable nodes and prints the denominator it took it over", async () => {
    const stdout = await draw(["--seed", "one"]);

    // 3 buckets × (1 + 19) + the shared solution + the orphan = 62 reviewable.
    expect(stdout).toContain("of 62 reviewable node(s) (10% asks for 7)");
    expect(sheetTitles(stdout)).toHaveLength(13);
  }, 60_000);

  test("the human-set Outcome is not on the sheet — nobody grades their own mandate", async () => {
    const titles = sheetTitles(await draw(["--fraction", "1", "--seed", "one"]));

    expect(titles).toHaveLength(62);
    expect(titles).not.toContain("Ship a tree somebody outside this room would act on");
  }, 60_000);

  test("a node two buckets reach is on the sheet exactly once, and says where else it hangs", async () => {
    const stdout = await draw(["--fraction", "1", "--seed", "one"]);
    const shared = "shared solution both ends of the alphabet link";

    expect(sheetTitles(stdout).filter((t) => t === shared)).toHaveLength(1);
    expect(stdout).toContain("also under: Zebra bucket");
  }, 60_000);
});

describe("the draw is stratified, not the alphabetical head", () => {
  test("every bucket is represented, including the two an alphabetical head would miss", async () => {
    const stdout = await draw(["--seed", "one"]);

    for (const b of BUCKETS) expect(stdout).toContain(`Bucket: ${b.title}`);
    // The head-of-the-list draw this replaces, stated as the thing it is not: the
    // first 13 titles in sort order are all one bucket's.
    const head = sheetTitles(await draw(["--fraction", "1", "--seed", "one"]))
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 13);
    expect(new Set(head.map((t) => t.slice(0, 3))).size).toBe(1);
    expect(new Set(sheetTitles(stdout).map((t) => t.slice(0, 3))).size).toBeGreaterThan(1);
  }, 60_000);

  test("every layer beneath every bucket is represented — no cell of the frame is missed", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toMatch(/Frame: 13 bucket × layer cell\(s\) hold a node; 13 are represented/);
    expect(stdout).toContain("every bucket and every layer");
    expect(stdout).not.toContain("MISSED");
    for (const layer of ["Opportunity", "Solution", "Assumption", "AssumptionTest"]) {
      expect(stdout).toMatch(new RegExp(`^ {2}${layer} — \\d+ of \\d+ drawn · each stands for`, "m"));
    }
  }, 60_000);

  test("a draw forced above the fraction to cover every cell says so rather than dropping cells", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("The draw is 6 above the 10% target");
  }, 60_000);

  test("with room to spare, the bigger cells get more of the draw than the smaller ones", async () => {
    const stdout = await draw(["--fraction", "0.5", "--seed", "one"]);
    const cells = [...stdout.matchAll(/^ {2}(\w+) — (\d+) of (\d+) drawn · each stands for/gm)].map((m) => ({
      layer: m[1],
      drawn: Number(m[2]),
      population: Number(m[3]),
    }));

    const sixes = cells.filter((c) => c.population === 6);
    const fours = cells.filter((c) => c.population === 4);
    expect(sixes.length).toBeGreaterThan(0);
    expect(fours.length).toBeGreaterThan(0);
    expect(Math.min(...sixes.map((c) => c.drawn))).toBeGreaterThan(Math.max(...fours.map((c) => c.drawn)));
  }, 60_000);

  test("each cell prints what one rating stands for, and the sheet refuses to be averaged flat", async () => {
    // The silent arithmetic error this exists to stop: at 10% on this fixture
    // every cell draws exactly one, so a plain mean over the sheet weighs a
    // 4-node cell the same as a 7-node one and answers a different question.
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("Solution — 1 of 7 drawn · each stands for 7");
    expect(stdout).toContain("Opportunity — 1 of 1 drawn · each stands for 1");
    expect(stdout).toContain("this is a COVERAGE sample and not a proportional one");
    expect(stdout).toContain('weight each node\'s ratings by the "stands for" figure');
  }, 60_000);

  test("nodes in no bucket are drawn under their own heading rather than dropped", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("Bucket: (in no bucket)");
    expect(stdout).toContain("sit under no bucket at all");
    expect(sheetTitles(stdout)).toContain("orphan opportunity nobody filed");
  }, 60_000);
});

describe("the draw is reproducible under a seed", () => {
  test("the same seed draws the same set", async () => {
    const { stdout: first } = await cli(["review-sample", "--vault", dir, "--seed", "steady"]);
    const { stdout: second } = await cli(["review-sample", "--vault", dir, "--seed", "steady"]);

    expect(sheetTitles(first)).toEqual(sheetTitles(second));
    expect(sheetTitles(first).length).toBeGreaterThan(0);
  }, 90_000);

  test("a different seed draws a different set", async () => {
    const one = sheetTitles(await draw(["--seed", "one"]));
    const two = sheetTitles(await draw(["--seed", "two"]));

    expect(two).not.toEqual(one);
    // Same shape, different members: a "different" draw that changed the size
    // would be a different sample, not a second opinion on the same one.
    expect(two).toHaveLength(one.length);
  }, 60_000);

  test("the header names the seed and the command that reproduces the draw", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain('seed "one"');
    expect(stdout).toContain('Reproduce this exact draw: ost-agent review-sample --seed "one"');
  }, 60_000);
});

describe("the sheet is for a person, and carries no score", () => {
  test("prints the three rubric criteria as unfilled checkboxes against each node", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("grounded — Does the node's claim stay inside the evidence it cites?");
    expect(stdout).toContain("classified — Is it in the right layer? An opportunity is a need, not a feature.");
    expect(stdout).toContain("useful — Would you keep it?");
    expect(stdout).toContain("[ ] grounded  [ ] classified  [ ] useful");
  }, 60_000);

  test("says in the output that it rates nothing and that the estimate stays with a human", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("This command rates nothing.");
    expect(stdout).toContain("This is the draw, and only the draw.");
    expect(stdout).toContain("none scores faithfulness or usefulness");
    // The one output shape that would make this a judge: a percentage, a grade,
    // or a count of nodes it decided were good.
    expect(stdout).not.toMatch(/grounding rate|score:|quality: /i);
  }, 60_000);

  test("a file the walk could not read is named as outside the frame, not counted as reviewed", async () => {
    const stdout = await draw(["--seed", "one"]);

    expect(stdout).toContain("1 file(s) could not be read and are OUTSIDE this frame entirely");
    expect(stdout).toContain("half-written node.md");
    // 62 is the parseable population; the unreadable file is not silently in it.
    expect(stdout).toContain("of 62 reviewable node(s)");
  }, 60_000);

  test("--titles is a bare list a script can consume", async () => {
    const stdout = await draw(["--seed", "one", "--titles"]);

    expect(stdout.trim().split("\n")).toEqual(sheetTitles(await draw(["--seed", "one"])));
  }, 60_000);
});

describe("refusals", () => {
  test("a vault holding nothing but its Outcome exits non-zero rather than reporting a clean review", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-review-sample-empty-"));
    try {
      await initVault(empty, "Nothing beneath me yet");
      await expect(cli(["review-sample", "--vault", empty, "--seed", "one"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("Nothing to review"),
      });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  }, 90_000);

  test("a fraction outside (0, 1] is refused rather than silently clamped", async () => {
    await expect(cli(["review-sample", "--vault", dir, "--fraction", "7"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("--fraction must be a number in (0, 1]"),
    });
  }, 60_000);
});
