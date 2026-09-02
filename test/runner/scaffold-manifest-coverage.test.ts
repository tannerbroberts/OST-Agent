/**
 * The scaffold-manifest census: how many of the captured exit-128 failures happened in a
 * directory this tool actually scaffolded?
 *
 * The solution under test is "The scaffolder writes a manifest of what it did and did not
 * initialise" — the writer pays once and every reader benefits. The assumption test asks
 * the feasibility question that shape raises before anything else, because a manifest can
 * only exist where the scaffolder ran: *if the observed failures happened in directories a
 * person or another tool created, the manifest is an optimisation on a fallback that has
 * to be built anyway.* The bar it fixed, before anything was counted: **at least 3 of the
 * 4 captured exit-128 failures occurred in a directory this tool created.**
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**, at the floor: **0 of 4**. Not one captured failure happened in
 * a directory `ost-agent init` had ever been pointed at, so on the reading the word
 * "scaffolded" plainly carries, the manifest would have been absent at every single one of
 * them. The command is green because the count has been taken and pinned — the convention
 * `test/runner/workspace-state-probe-coverage.test.ts`,
 * `test/runner/workspace-map-coverage.test.ts` and
 * `test/runner/unconditional-scaffold-init.test.ts` all run under. Whoever reads this exit
 * code must read `census.headline.meetsBar` with it, which is why it is asserted `false`
 * by name below rather than left to be inferred.
 *
 * ## The one reading that clears is the reading where the mechanism does not exist
 *
 * Read "a directory this tool created" as "any directory a tool call in the record brought
 * into being" and the node's own four cited failures come out **3 of 4** — exactly the
 * threshold, exactly cleared. All three are `/Users/tanner/dev/apple-epoch-primes`, and the
 * record says what created it: a coding agent's `Write` of `index.mjs`. No scaffolder ran
 * there. There is no code path in this repository, before or after this change, that would
 * have put a manifest in that directory. The reading that clears the bar is the reading
 * under which the file being counted on does not exist, and that is asserted by name below
 * rather than reported as a near-miss.
 *
 * ## Two things the count says that the node does not
 *
 * 1. **The node's motivating example cannot be produced by this scaffolder.** The solution
 *    names `git: false` as the kind of negative a manifest would carry. `initVault` calls
 *    `gitInitIfAbsent` on every scaffold with no flag to skip it, so a manifest this tool
 *    writes can say "I initialised it" or "it was already a repository" and never "this is
 *    not a repository". The claim the whole parent opportunity is about is the one claim
 *    this scaffolder is structurally unable to make.
 * 2. **Most of the manifest saves a reader nothing.** Each claim carries its `probeCost`,
 *    and five of the eight are answerable in a single `existsSync` — including
 *    `git-repository`, the one the captured failures were about. "The writer pays once and
 *    every reader benefits" is measured here and the benefit is one syscall.
 *
 * The rule is `SCAFFOLD_MANIFEST_RULE`, committed in `src/runner/scaffold-manifest.ts`
 * before the corpus was counted. The corpus is the sibling census's, frozen in
 * `test/fixtures/scaffold-init/` — the same cut, deliberately shared, because two censuses
 * over the same failures disagreeing about what "tool-created" means would be a bug in one
 * of them rather than a finding in either. See its `PROVENANCE.md` for the cut and every
 * exclusion. This test asserts the shape of the rule as well as its output, so a later edit
 * shows up here as a changed expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  buildScaffoldManifest,
  claimsWorthReading,
  formatScaffoldManifestCensus,
  readScaffoldManifest,
  scaffoldManifestCoverage,
  verifyScaffoldManifest,
  writeScaffoldManifest,
  SCAFFOLD_MANIFEST_FILE,
  SCAFFOLD_MANIFEST_RULE,
  SCAFFOLD_MANIFEST_VERSION,
  type ManifestFs,
  type ScaffoldFacts,
} from "../../src/runner/scaffold-manifest.js";
import {
  classifyUninitialisedRepoFailure,
  CITED_SESSIONS,
  type CreationEvidence,
  type UninitialisedRepoFailure,
} from "../../src/runner/scaffold-init.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "scaffold-init");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed: at least 3 of the 4 captured failures", () => {
    expect(SCAFFOLD_MANIFEST_RULE.minCovered).toBe(3);
    expect(SCAFFOLD_MANIFEST_RULE.ofFailures).toBe(4);
  });

  test("the cut is the node's own four sessions, because 3-of-4 is not well-formed against a record of 6", () => {
    expect(SCAFFOLD_MANIFEST_RULE.cut).toBe("node-cut");
    // The whole record is counted beside it rather than instead of it — see the
    // cited-versus-found block at the end.
    expect(Object.keys(SCAFFOLD_MANIFEST_RULE.cuts)).toEqual(["node-cut", "whole-record"]);
  });

  test("`scaffolded` is pinned in the rule, because the bar cannot be decided without it", () => {
    // The one thing the node left open and this census had to close. The strict reading
    // is the bar; the generous one runs beside it so no argument about definitions can
    // be made after the number is known.
    expect(SCAFFOLD_MANIFEST_RULE.bar).toBe("scaffolder");
    expect(SCAFFOLD_MANIFEST_RULE.readings.scaffolder).toContain("`ost-agent init` pointed at this directory");
    expect(SCAFFOLD_MANIFEST_RULE.readings["any-agent-tool"]).toContain("would carry no manifest");
  });

  test("the constraint a coverage count cannot express is pinned as part of the rule", () => {
    // A manifest is a file the scaffolder writes. Counting a failure as covered in a
    // directory no scaffolder touched is counting on a file that was never there.
    expect(SCAFFOLD_MANIFEST_RULE.manifestExistsOnlyWhereScaffolderRan).toBe(true);
  });

  test("the failure shape is the sibling census's, imported rather than restated", () => {
    // Two definitions of "the captured exit-128 failures" would be two different corpora
    // wearing the same name.
    expect(SCAFFOLD_MANIFEST_RULE.failureSignature.source).toContain("fatal: not a git repository");
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

function committed(): { failures: UninitialisedRepoFailure[]; evidence: CreationEvidence[]; meta: Record<string, unknown> } {
  const failures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "failures.json"), "utf8")) as UninitialisedRepoFailure[];
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, unknown>;
  return { failures, evidence: meta.evidence as CreationEvidence[], meta };
}

describe("the census over the committed corpus", () => {
  const { failures, evidence, meta } = committed();
  const census = scaffoldManifestCoverage(failures, evidence, { citedSessions: CITED_SESSIONS });

  test("the corpus is the one PROVENANCE.md describes, re-derived rather than trusted", () => {
    // Re-deriving from the upstream file means a change to the classifier cannot leave a
    // stale corpus behind agreeing with a number nobody computes any more.
    const upstream = fs
      .readFileSync(path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { session: string; tool: string; command: string; error: string });
    const rederived = upstream.map(classifyUninitialisedRepoFailure).filter((r): r is UninitialisedRepoFailure => r !== null);
    expect(rederived).toEqual(failures);
    expect(meta.upstreamFailures).toBe(719);
    expect(failures).toHaveLength(6);
    expect(census.byDirectory).toHaveLength(4);
  });

  test("THE ASSUMPTION IS REFUTED — 0 of the node's 4 captured failures were in a scaffolded directory", () => {
    // Read this with the exit code. The command is green because the count has been
    // taken; the count says the manifest would have been absent at every one of them.
    expect(census.headline.cut).toBe("node-cut");
    expect(census.headline.reading).toBe("scaffolder");
    expect(census.headline.failures).toBe(4);
    expect(census.headline.covered).toBe(0);
    expect(census.headline.threshold).toBe(3);
    expect(census.headline.meetsBar).toBe(false);
    expect(formatScaffoldManifestCensus(census)).toContain("REFUTED");
  });

  test("it is refuted on the whole record too, so the cut is not what decides it", () => {
    const whole = census.counts.find((c) => c.cut === "whole-record" && c.reading === "scaffolder");
    expect(whole).toMatchObject({ failures: 6, covered: 0, meetsThreshold: false });
  });

  test("not one of the four directories was ever scaffolded by this tool", () => {
    expect(census.byDirectory.map((r) => r.dir)).toEqual([
      "/Users/tanner/dev/apple-epoch-primes",
      "/Users/tanner/dev/ost-benchmarks",
      "/tmp/ost-main",
      "/tmp/ost-npm-archive",
    ]);
    expect(census.byDirectory.every((r) => r.byScaffolder)).toBe(false);
    expect(census.byDirectory.some((r) => r.byScaffolder)).toBe(false);
    // Which is the same fact as: nowhere in this corpus would there have been a file.
    expect(census.byDirectory.filter((r) => r.manifestWouldExist)).toEqual([]);
  });

  test("THE ONE READING THAT CLEARS IS THE ONE WHERE NO MANIFEST WOULD HAVE EXISTED", () => {
    // 3 of 4, exactly on the threshold — and all three in a directory a coding agent's
    // `Write` of index.mjs brought into being. This is asserted, not hidden, because it
    // is the finding: whoever reads the refutation is entitled to the number that
    // clears, and to the reason it does not count.
    const generous = census.counts.find((c) => c.cut === "node-cut" && c.reading === "any-agent-tool");
    expect(generous).toMatchObject({ failures: 4, covered: 3, meetsThreshold: true, coveredWithAManifest: 0 });
    expect(census.clearsWithoutAManifest).toHaveLength(2);
    expect(census.clearsWithoutAManifest.every((c) => c.reading === "any-agent-tool")).toBe(true);
    expect(census.clearsWithoutAManifest.every((c) => c.coveredWithAManifest === 0)).toBe(true);

    const primes = census.byDirectory.find((r) => r.dir === "/Users/tanner/dev/apple-epoch-primes");
    expect(primes?.failuresInNodeCut).toBe(3);
    expect(primes?.evidence.creator?.tool).toBe("Write");
    expect(primes?.manifestWouldExist).toBe(false);
  });

  test("two directories have no establishable creator, and the unknown counts against the candidate", () => {
    // A missing transcript is recorded as a missing transcript. Reading it as "not
    // scaffolded" is the reading that runs against this candidate, which is the correct
    // direction for an unknown to run in a feasibility test.
    expect(census.creatorUnknown).toEqual(["/Users/tanner/dev/ost-benchmarks", "/tmp/ost-npm-archive"]);
    expect(census.byDirectory.filter((r) => r.evidence.absent === "transcript-gone")).toHaveLength(2);
  });

  test("the node counted four sessions; the record holds six, and two are in no node's list", () => {
    expect(census.citedVersusFound.cited).toHaveLength(4);
    expect(census.citedVersusFound.found).toHaveLength(6);
    expect(census.citedVersusFound.uncited).toEqual(["0f940e60-26f9-459a-ace4-5af5ce438e2b", "agent-a022e255367d9bdf0"]);
    expect(census.directoryUnknown).toBe(0);
  });

  test("the report says the verdict in words and publishes what would overturn it", () => {
    const report = formatScaffoldManifestCensus(census);
    expect(report).toContain("REFUTED");
    expect(report).toContain("against a pre-committed threshold of 3");
    expect(report).toContain("node-cut × any-agent-tool: 3/4");
    expect(report).toContain("only 0 of those would have carried a manifest");
    expect(report).toContain("NO — no scaffolder ever ran here");
    expect(report).toContain("A bar met by counting directories the mechanism cannot reach is not a bar met.");
  });
});

// ── the mechanism: what the scaffolder can and cannot claim ──────────────────

const FACTS: ScaffoldFacts = {
  gitInitialized: true,
  outcomeCreated: true,
  outcomeFile: "My Vault.md",
  // `initVault` knows these only as absolute paths; the manifest relativises the ones
  // that are actually inside the vault. See the portability block below.
  inboxDir: "/h/My Vault.inbox",
  inboxConfined: true,
  remoteUrl: null,
  toolDeclaration: { status: "written", file: "/h/vault/.mcp.json" },
  toolEnabling: { status: "enabled", file: "/h/vault/.claude/settings.json" },
};

const AT = "2026-09-02T00:00:00.000Z";
const manifest = buildScaffoldManifest("/h/vault", FACTS, { at: AT, toolVersion: "0.23.0" });

describe("the manifest records what was NOT done, which is the half nothing else carries", () => {
  test("the negatives are present as claims, not as absent keys", () => {
    // An absent key and a `false` are the same observable to a reader that has to guess,
    // which is the failure this whole opportunity is about.
    const negatives = manifest.claims.filter((c) => !c.did).map((c) => c.id);
    expect(negatives).toContain("dependencies-installed");
    expect(negatives).toContain("remote-configured");
    expect(manifest.claims.find((c) => c.id === "remote-configured")?.detail).toContain("no remote");
  });

  test("THE NODE'S OWN MOTIVATING EXAMPLE CANNOT BE PRODUCED BY THIS SCAFFOLDER", () => {
    // The solution names `git: false` as the kind of negative a manifest would carry.
    // `initVault` calls `gitInitIfAbsent` unconditionally, so the two reachable states
    // are "I initialised it" and "it was already a repository" — never "not a repository".
    const adopted = buildScaffoldManifest("/h/vault", { ...FACTS, gitInitialized: false }, { at: AT, toolVersion: "0.23.0" });
    for (const m of [manifest, adopted]) {
      const git = m.claims.find((c) => c.id === "git-repository");
      expect(git?.witness).toEqual({ path: ".git", expect: "present" });
    }
    expect(manifest.claims.find((c) => c.id === "git-repository")?.detail).toContain("ran `git init`");
    expect(adopted.claims.find((c) => c.id === "git-repository")?.detail).toContain("already a repository");
  });

  test("MOST OF THE MANIFEST SAVES A READER NOTHING, and each claim says so", () => {
    // "The writer pays once and every reader benefits" is the candidate's economic
    // claim. Measured: five of eight claims are answerable in one existsSync, so the
    // benefit for those is a relabelled syscall. The three worth reading are the ones
    // whose answer is not sitting in the directory in that shape.
    expect(manifest.claims).toHaveLength(8);
    expect(manifest.claims.filter((c) => c.probeCost === "stat")).toHaveLength(5);
    expect(claimsWorthReading(manifest)).toEqual(["remote-configured", "tool-declaration", "tool-enabling"]);
    // Including the one the captured failures were actually about.
    expect(manifest.claims.find((c) => c.id === "git-repository")?.probeCost).toBe("stat");
  });

  test("it names its writer and its version, so a foreign file is not read as ours", () => {
    expect(manifest.tool).toBe("ost-agent");
    expect(manifest.version).toBe(SCAFFOLD_MANIFEST_VERSION);
    expect(manifest.scaffoldedAt).toBe(AT);
    expect(manifest.dir).toBe(path.resolve("/h/vault"));
  });
});

// ── staleness: the node's own stated blocker ─────────────────────────────────

function toyFs(present: string[], files: Record<string, string> = {}): ManifestFs {
  const set = new Set(present);
  return { exists: (p) => set.has(p) || p in files, read: (p) => files[p] ?? null };
}

/** Everything the manifest above claims, actually on disk. */
const CONSISTENT = ["/h/vault/.git", "/h/vault/ost.config.yaml", "/h/vault/My Vault.md", "/h/My Vault.inbox", "/h/vault/.mcp.json", "/h/vault/.claude/settings.json"];

describe("a claim is checked against the directory, never handed over as a belief", () => {
  test("a manifest that still describes the world reads fresh on every claim", () => {
    const reading = verifyScaffoldManifest(manifest, "/h/vault", toyFs(CONSISTENT));
    expect(reading.stale).toEqual([]);
    expect(reading.unverifiable).toEqual([]);
    expect(reading.trustworthy).toBe(true);
  });

  test("STALENESS IS DETECTED RATHER THAN BELIEVED — the node's stated blocker, answered", () => {
    // Somebody ran `npm install` in the vault after it was scaffolded. The manifest now
    // says `dependencies-installed: false` and the directory disagrees. A reader that
    // believed the file would proceed confidently; this one is told which claim to probe.
    const reading = verifyScaffoldManifest(manifest, "/h/vault", toyFs([...CONSISTENT, "/h/vault/node_modules"]));
    expect(reading.stale).toEqual(["dependencies-installed"]);
    expect(reading.trustworthy).toBe(false);
    expect(reading.advice).toContain("probe those rather than believing the manifest");
  });

  test("a claim carried by a file's contents goes stale when the contents change", () => {
    // `git remote add origin …` after scaffolding. Nothing about the directory listing
    // changes; the claim is wrong anyway.
    const reading = verifyScaffoldManifest(manifest, "/h/vault", toyFs(CONSISTENT, { "/h/vault/.git/config": '[remote "origin"]\n\turl = git@github.com:x/y.git\n' }));
    expect(reading.stale).toEqual(["remote-configured"]);
    expect(reading.claims.find((c) => c.claim.id === "remote-configured")?.observed).toContain("now contains [remote ");
  });

  test("the drop folder is witnessed at its absolute path, because it lives outside the vault", () => {
    // The claim a reader most wants and the one a vault-relative witness would miss:
    // W1 puts the folder outside the working tree on purpose.
    const gone = CONSISTENT.filter((p) => p !== "/h/My Vault.inbox");
    expect(verifyScaffoldManifest(manifest, "/h/vault", toyFs(gone)).stale).toEqual(["drop-folder"]);
  });
});

describe("the manifest travels with the vault, because it is committed inside it", () => {
  test("every witness inside the vault is relative, so a clone does not read as tampered-with", () => {
    // The bug this closes: `initVault` knows `.mcp.json` and `.claude/settings.json` only
    // as absolute paths, and `init`'s own commit puts the manifest in git. Baking the
    // machine's paths in would make three claims read `stale` on every clone — a false
    // alarm wearing the staleness detection's clothes.
    const inside = manifest.claims.filter((c) => c.witness && !c.witness.outsideVault);
    expect(inside.map((c) => c.witness!.path)).toEqual([
      ".git",
      path.join(".git", "config"),
      "node_modules",
      "ost.config.yaml",
      "My Vault.md",
      ".mcp.json",
      path.join(".claude", "settings.json"),
    ]);
    expect(inside.every((c) => !path.isAbsolute(c.witness!.path))).toBe(true);
  });

  test("only the drop folder stays absolute, and it says so rather than hiding it", () => {
    const outside = manifest.claims.filter((c) => c.witness?.outsideVault);
    expect(outside.map((c) => c.id)).toEqual(["drop-folder"]);
    expect(outside[0].witness!.path).toBe(path.resolve("/h/My Vault.inbox"));
  });

  test("a vault that MOVED is distinguished from a vault that CHANGED", () => {
    // Same manifest, verified against a copy of the vault at a new path. Everything
    // inside it still resolves; only the outside-the-vault claim fails, and the reading
    // says which of the two situations that is instead of crying tampering.
    const moved = ["/elsewhere/vault/.git", "/elsewhere/vault/ost.config.yaml", "/elsewhere/vault/My Vault.md", "/elsewhere/vault/.mcp.json", "/elsewhere/vault/.claude/settings.json"];
    const reading = verifyScaffoldManifest(manifest, "/elsewhere/vault", toyFs(moved));
    expect(reading.stale).toEqual(["drop-folder"]);
    expect(reading.movedVaultSuspected).toBe(true);
    expect(reading.advice).toContain("a vault that moved rather than a vault that changed");

    // A claim inside the vault going stale is not that, and must not be softened into it.
    const tampered = verifyScaffoldManifest(manifest, "/h/vault", toyFs([...CONSISTENT, "/h/vault/node_modules"]));
    expect(tampered.movedVaultSuspected).toBe(false);
  });
});

describe("a directory with no manifest gets the honest answer, not a guess", () => {
  test("absence says the tool did not scaffold here and the state must be probed", () => {
    // The node's own concession, made operational: a folder a person made, or another
    // tool made, or that was cloned, has no manifest. This is every directory in the
    // census above.
    const reading = readScaffoldManifest("/h/plain", toyFs([]));
    expect(reading.status).toBe("absent");
    expect(reading.trustworthy).toBe(false);
    expect(reading.claims).toEqual([]);
    expect(reading.advice).toContain("this tool did not scaffold this directory");
    expect(reading.advice).toContain("has to be probed");
  });

  test("a file that is not JSON, and a manifest from another tool or version, both fall back to probing", () => {
    const file = path.join("/h/vault", SCAFFOLD_MANIFEST_FILE);
    expect(readScaffoldManifest("/h/vault", toyFs([], { [file]: "not json {" })).status).toBe("unreadable");
    expect(readScaffoldManifest("/h/vault", toyFs([], { [file]: JSON.stringify({ tool: "somebody-else", version: 1, claims: [] }) })).status).toBe("foreign");
    expect(readScaffoldManifest("/h/vault", toyFs([], { [file]: JSON.stringify({ tool: "ost-agent", version: 99, claims: [] }) })).status).toBe("foreign");
  });
});

describe("round-tripping through a real directory", () => {
  test("what is written is what is read back, and it verifies against the disk it describes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-manifest-"));
    try {
      const facts: ScaffoldFacts = {
        ...FACTS,
        outcomeFile: "Vault.md",
        inboxDir: path.join(dir, "..", "inbox"),
        toolDeclaration: { status: "written", file: path.join(dir, ".mcp.json") },
        toolEnabling: { status: "enabled", file: path.join(dir, ".claude", "settings.json") },
      };
      for (const p of [".git", "ost.config.yaml", "Vault.md", ".mcp.json"]) fs.mkdirSync(path.join(dir, p), { recursive: true });
      fs.mkdirSync(path.join(dir, ".claude", "settings.json"), { recursive: true });
      fs.mkdirSync(path.join(dir, "..", "inbox"), { recursive: true });

      const file = writeScaffoldManifest(dir, buildScaffoldManifest(dir, facts, { at: AT, toolVersion: "0.23.0" }));
      expect(file).toBe(path.join(dir, SCAFFOLD_MANIFEST_FILE));

      const reading = readScaffoldManifest(dir);
      expect(reading.status).toBe("read");
      expect(reading.manifest?.scaffoldedAt).toBe(AT);
      expect(reading.stale).toEqual([]);
      expect(reading.trustworthy).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
