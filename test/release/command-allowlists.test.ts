/**
 * Every shipped slash command's `allowed-tools` names only tools that exist
 * (readiness criterion **D2**).
 *
 * Why this is a build failure and not a review item: under
 * `-p --permission-mode acceptEdits` — the mode the unattended examples run in —
 * a tool call outside the grant is **denied, not prompted**. There is no human
 * to approve it and no error the model must surface. So a single misspelled or
 * renamed name does not break the pass; it *quietly narrows* it. The pass runs,
 * skips whatever that name was for, and reports done. This repo already lived
 * that once: `ost_ingest_inbox` fell out of the automation examples' copies of
 * `/ost-pass`'s list, the pass ingested nothing, and the fix
 * (`test/release/examples-allowlist.test.ts`) pinned only the downstream half —
 * that the examples match `ost-pass.md`. Nothing checked that `ost-pass.md`
 * itself, or the eight other command files, named anything real. Eight of the
 * nine are hand-written with no generator behind them.
 *
 * Three things make this a pin rather than a snapshot:
 *
 * 1. **The command files are globbed, never listed.** A new `/ost-*` command is
 *    audited the moment it lands, which is the only way this survives the next
 *    person adding one.
 * 2. **Both authorities are derived from source, never transcribed.** MCP names
 *    come from `MCP_TOOL_NAMES` (`src/mcp/server.ts`), the CLI subcommand set is
 *    grepped out of `src/cli/index.ts`, and the `mcp__…__` prefix is read off the
 *    server key in `.claude-plugin/plugin.json`. A list retyped here would be a
 *    fourth copy of the very thing whose copies keep drifting.
 * 3. **Non-`mcp__` entries are matched against an explicit form, not waved
 *    through.** `/ost-setup` legitimately grants two `Bash(…)` prefixes, so
 *    "every entry must be an MCP tool" is wrong — but "any Bash grant is fine"
 *    would let a bare `Bash` into the one product whose promise is that it holds
 *    no shell. The grant must be
 *    `Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs <subcommand>:*)` with a
 *    `<subcommand>` the CLI actually defines.
 *
 * **Non-vacuity, and how it was proved.** Nine files that happen to be correct
 * today would make the block below green whether or not it checks anything, so
 * the auditor is also run over fixtures that are each wrong in one way — a
 * misspelled tool, a tool that never existed, an unknown subcommand, a bare
 * `Bash`, a wildcard shell grant wearing the right shape, another server's
 * prefix, a missing frontmatter key — and each must be reported. That the
 * fixtures discriminate was confirmed by mutation, twice, before this comment
 * was written: neutering the `MCP_NAMES.has(tool)` branch turned exactly the two
 * MCP fixtures red, and neutering the `BASH_GRANT` match turned exactly the two
 * shell-shape fixtures red. Neither mutation disturbed the nine real files,
 * which is the point — they cannot carry the proof.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { initVault } from "../../src/runner/init.js";
/**
 * The prefix a session actually mints for this plugin's tools — imported, never
 * re-derived here.
 *
 * This file used to carry its own copy of the derivation, and so did
 * `test/release/command-allowlists.test.ts` and `scripts/gen-skill.ts`. All three
 * copies read the manifest's `mcpServers` key and produced `mcp__<server>__`,
 * which is what a DIRECTLY registered server mints. A plugin-delivered server —
 * the only install path `README.md` documents — mints
 * `mcp__plugin_<plugin>_<server>__`. Three independent derivations, all wrong the
 * same way, so every guard agreed with the thing it was guarding for 23 releases.
 * Deriving is not the same as deriving correctly, and the fix for that is one
 * derivation rather than three careful ones.
 */
import { MCP_PREFIX } from "../../scripts/mcp-prefix.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS_DIR = path.join(repoRoot, ".claude", "commands");



/**
 * Every subcommand `src/cli/index.ts` defines, read out of the source.
 *
 * Grepped, not listed, for the D2 reason itself: a hand-kept list here would let
 * a command file grant `Bash(… promote:*)` after `promote` was renamed and this
 * test would still be green.
 */
const SUBCOMMANDS: ReadonlySet<string> = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src", "cli", "index.ts"), "utf8");
  return new Set([...src.matchAll(/\.command\("([a-z][a-z0-9-]*)"\)/g)].map((m) => m[1]));
})();

/**
 * The one non-MCP grant form this repo permits. Narrow on purpose: `node`, the
 * one committed bundle, one named subcommand, arguments open. There is no
 * `ost-agent` binary on any PATH, so any other shape is either a typo or a
 * widening nobody argued for.
 */
const BASH_GRANT = /^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/ost-agent\.mjs ([a-z][a-z0-9-]*):\*\)$/;

const MCP_NAMES: ReadonlySet<string> = new Set<string>(MCP_TOOL_NAMES);

/** Pull the `allowed-tools:` line out of a command file's YAML frontmatter. */
function allowedToolsLine(source: string): string | undefined {
  const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(/^allowed-tools:\s*(.+)$/m);
  return line ? line[1].trim() : undefined;
}

/**
 * Audit one command file's frontmatter. Returns a list of human-readable
 * problems — empty means the file grants only tools that exist.
 *
 * Exported shape (a pure function of the file's text plus the derived
 * authorities) is what lets the non-vacuity fixtures below run the *same* code
 * the real files run, rather than a re-implementation that could be wrong in a
 * compensating direction.
 */
export function auditCommandFile(label: string, source: string): string[] {
  const problems: string[] = [];
  const line = allowedToolsLine(source);
  if (line === undefined) {
    return [`${label}: no \`allowed-tools\` key in its frontmatter — the command grants nothing`];
  }

  const entries = line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) problems.push(`${label}: \`allowed-tools\` is empty`);

  for (const entry of entries) {
    if (entry.startsWith("mcp__")) {
      if (!entry.startsWith(MCP_PREFIX)) {
        problems.push(`${label}: "${entry}" is not a tool of this plugin's server (expected prefix ${MCP_PREFIX})`);
        continue;
      }
      const tool = entry.slice(MCP_PREFIX.length);
      if (!MCP_NAMES.has(tool)) {
        problems.push(`${label}: "${entry}" — no such tool; MCP_TOOL_NAMES has no ${tool}`);
      }
      continue;
    }

    const bash = entry.match(BASH_GRANT);
    if (!bash) {
      problems.push(
        `${label}: "${entry}" is neither an ${MCP_PREFIX}* tool nor a ` +
          "`Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs <subcommand>:*)` grant",
      );
      continue;
    }
    if (!SUBCOMMANDS.has(bash[1])) {
      problems.push(`${label}: "${entry}" — \`${bash[1]}\` is not a subcommand of src/cli/index.ts`);
    }
  }
  return problems;
}

const commandFiles = fs
  .readdirSync(COMMANDS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("the derived authorities are real (so nothing below can pass vacuously)", () => {
  test("MCP_TOOL_NAMES and the CLI subcommand set are both populated", () => {
    // Either set coming back empty would fail every file rather than pass them —
    // the checks are fail-closed — but an empty set would also make the failure
    // message point at the wrong thing, so it is named here.
    expect(MCP_NAMES.size).toBeGreaterThanOrEqual(18);
    expect(SUBCOMMANDS.size).toBeGreaterThanOrEqual(10);
    for (const sub of ["init", "set-outcome", "gate", "promote"]) {
      expect(SUBCOMMANDS, `src/cli/index.ts defines ${sub}`).toContain(sub);
    }
    expect(MCP_PREFIX).toBe("mcp__plugin_ost-agent_ost-agent__");
  });

  test("every shipped command file is being audited", () => {
    // The criterion is stated over "the nine files in .claude/commands". The
    // floor is asserted rather than the exact number so that adding a tenth
    // command is not a test edit — but losing one is.
    expect(commandFiles.length).toBeGreaterThanOrEqual(9);
    expect(commandFiles).toContain("ost-pass.md");
    expect(commandFiles).toContain("ost-setup.md");
  });
});

describe("every command's allowed-tools names only tools that exist (D2)", () => {
  for (const file of commandFiles) {
    test(`.claude/commands/${file}`, () => {
      const source = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8");
      expect(auditCommandFile(file, source)).toEqual([]);
    });
  }
});

/**
 * The control. Each fixture is a command file that is wrong in exactly one way,
 * and each must be reported — otherwise the block above is a test that reads
 * nine files and asserts nothing about them.
 */
const BROKEN: ReadonlyArray<[why: string, frontmatter: string, expected: RegExp]> = [
  [
    "a misspelled MCP tool",
    "mcp__plugin_ost-agent_ost-agent__ost_read_tree, mcp__plugin_ost-agent_ost-agent__ost_creat_node",
    /no such tool.*ost_creat_node/,
  ],
  [
    "a tool that was never on the surface",
    "mcp__plugin_ost-agent_ost-agent__ost_delete_node",
    /no such tool.*ost_delete_node/,
  ],
  [
    "a Bash grant for a subcommand the CLI does not define",
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs initialise:*)",
    /is not a subcommand/,
  ],
  [
    "a bare shell grant",
    "Bash",
    /is neither an mcp__plugin_ost-agent_ost-agent__\* tool nor a/,
  ],
  [
    "a wildcard shell grant dressed up as the real form",
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs:*)",
    /is neither an mcp__plugin_ost-agent_ost-agent__\* tool nor a/,
  ],
  [
    "another server's tool",
    "mcp__some-other-server__ost_read_tree",
    /not a tool of this plugin's server/,
  ],
];

describe("the auditor reports a command file that grants something unreal", () => {
  for (const [why, frontmatter, expected] of BROKEN) {
    test(why, () => {
      const source = `---\ndescription: fixture\nallowed-tools: ${frontmatter}\n---\n\nbody\n`;
      const problems = auditCommandFile("fixture.md", source);
      expect(problems.length, `${frontmatter} was accepted`).toBeGreaterThan(0);
      expect(problems.join("\n")).toMatch(expected);
    });
  }

  test("a command file with no allowed-tools key at all is reported", () => {
    expect(auditCommandFile("fixture.md", "---\ndescription: fixture\n---\n\nbody\n")).toEqual([
      "fixture.md: no `allowed-tools` key in its frontmatter — the command grants nothing",
    ]);
  });

  test("a well-formed fixture passes, so the auditor is not simply always-red", () => {
    const source =
      "---\ndescription: fixture\n" +
      "allowed-tools: mcp__plugin_ost-agent_ost-agent__ost_read_tree, Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init:*)\n" +
      "---\n\nbody\n";
    expect(auditCommandFile("fixture.md", source)).toEqual([]);
  });
});

/* ========================================================================== *
 * W6 — no shipped command grants a Bash subcommand that writes the tree.
 * ========================================================================== */

/**
 * **Status: met since 2026-07-30, and the register below is empty.** It was not
 * when this block was written — `/ost-setup` granted `Bash(… set-outcome:*)`, and
 * that grant is gone from `renderSetupCommand()` in `scripts/gen-skill.ts`, with
 * step 3 of the command now restoring a missing root through `init` (which reads
 * the mandate out of `ost.config.yaml` and discards the argv) instead of handing
 * the human a `set-outcome` that throws in the one state step 3 fires for. The
 * assertion shape did not change with the verdict: it is still exact equality
 * against the register, so re-granting a tree-writing subcommand fails the build
 * on the commit that does it, and the register cannot be widened without an entry
 * that argues for itself.
 *
 * D2 above asks whether a granted subcommand **exists**. W6 asks what it
 * **does**, and the two are not the same question: `set-outcome` resolves
 * perfectly and rewrites the mandate the whole tree hangs from. A name that
 * type-checks is not a name that is safe to hand a model, so the second half of
 * the audit lives here rather than in a separate file — the enumeration (which
 * `Bash(…)` prefixes the nine command files grant) is shared, and a second file
 * globbing the same directory would be a second thing to keep in step.
 *
 * **The classification is behavioural, and had to be.** Two static shapes were
 * tried against the same source and both decide nothing:
 *
 *   - *Module reachability* (the walk `module-reachability.test.ts` uses) calls
 *     every subcommand a writer. `status` reaches `buildPassContext` reaches
 *     `src/ost/vault.ts`, and that file contains `fs.writeFileSync`. Import
 *     reachability cannot separate a command that opens the `Vault` class from
 *     one that calls a mutator on it.
 *   - *Per-handler analysis* — read the identifiers in one `.action(…)` block,
 *     map them back through index.ts's imports, walk from there — is a
 *     re-implementation of the type checker that would still be defeated by one
 *     helper indirection, which is the failure mode `outward-mutation.test.ts`
 *     names in its own note 4.
 *
 * So each granted subcommand is **run**, against a real scratch vault that is
 * already initialised, and the tree is compared byte for byte on either side.
 *
 * **"The tree" is the vault's node files plus `ost.config.yaml`, and not the
 * `.ost-agent/` sidecar.** Not a convenience: `init` records a usage event on
 * every run (`recordInitInTrace`, `src/runner/init.ts:38-51`) and W2/W3 need it
 * to, so a snapshot of the whole directory would classify the one subcommand
 * this criterion accepts as a writer and the check would collapse into "grant
 * nothing". The config is **in** for the reason F6 gives: three of the six Gate F
 * inputs (`loop.cadence`, `loop.spend`, `loop.lockTtlMinutes`) live in that file
 * inside the working tree, sheltered by W5's deny list and by this grant staying
 * narrow. A granted subcommand that rewrites `ost.config.yaml` edits the ceiling
 * it is bounded by.
 *
 * **Why `init` comes out safe is a property, not an exemption — but the property
 * is bigger than what this file samples.** The probe hands it an outcome that
 * *differs* from the one the fixture was initialised with; the root node and the
 * config come back byte-identical, because init is non-destructive and
 * re-runnable by construction. If someone ever makes init overwrite an adopted
 * vault, this goes red on `init` with no edit here.
 *
 * What that samples is ONE state — a healthy vault — while `Bash(… init:*)`
 * grants the whole argument space in every state. Two gaps are worth naming so
 * nobody reads this verdict as wider than it is:
 *
 *   - `--title`, the only other flag init takes, is a no-op against a live vault
 *     for the same reason `--outcome` is: `initVault` short-circuits on an
 *     existing config. Checked by hand; not pinned here, because pinning it
 *     would be a second probe of the same short-circuit.
 *   - `no-outcome` is the one reachable state where a granted `init` really does
 *     write a node file into an existing vault. It is still not an authorship
 *     route — the bytes come from the config, and the argv's outcome is
 *     discarded — and that is pinned, in `test/runner/set-outcome.test.ts`,
 *     where the same fact is also the finding that step 3 has no working remedy.
 *
 * So the criterion-relevant property is: in every reachable state, `init` cannot
 * put model-chosen text into an existing tree. `set-outcome` can. That, and not
 * "the agent must never originate the mandate", is what separated the two grants
 * — the agent composes the `--outcome` string on the `no-vault` branch of
 * `/ost-setup` too, so dropping `set-outcome:*` narrowed what the model can
 * *retune*, not what it can originate.
 *
 * **Fail-closed in two places, both of which would otherwise read as safe, and
 * both now load-bearing rather than incidental.** A granted subcommand with no
 * probe recipe fails rather than being skipped, and a probe that exits non-zero
 * fails rather than being recorded as "wrote nothing". Neither is hypothetical:
 * `set-outcome` **throws** in the `no-outcome` state (`test/runner/set-outcome.test.ts`),
 * so a probe run against that state would have reported the violation clean. With
 * the register empty, an empty verdict is now the *expected* answer — every route
 * to a spurious empty verdict is a route to a green build, so both guards get a
 * test of their own below instead of resting on a mutation someone once ran by
 * hand.
 *
 * **Non-vacuity.** `set-outcome` is probed by name whatever the command files
 * grant, so the prober is proved capable of catching a tree-writer on every run —
 * that control is what stops the now-empty register from being an empty check.
 * Three mutations were also run by hand when this block was written: renaming the
 * register's key turned exactly the register tests red and left the probes alone;
 * collapsing `PROBE_MANDATE` onto `BASELINE_MANDATE` made `set-outcome` refuse
 * with "identical" and the suite failed on the non-zero exit rather than recording
 * the violation as clean; and pointing `init`'s recipe at `set-outcome`'s argv
 * turned the `init` verdict and the register verdict red together.
 */

// The local tsx binary, not `npx` — `npx` takes npm's cacache lock and dozens of
// concurrent spawns contend on it (the note `test/cli/loop.test.ts` already
// carries).
const TSX = path.join(repoRoot, "node_modules", ".bin", "tsx");
/**
 * `src/cli/index.ts`, not `dist/ost-agent.mjs`, though the grant names the
 * bundle. The `bundle-drift` CI job is what makes the two the same program; it
 * runs whether or not this file does, and reading source keeps this check from
 * going green against a stale bundle or red against a source change nobody has
 * bundled yet.
 */
const CLI = path.join(repoRoot, "src", "cli", "index.ts");

const BASELINE_MANDATE = "The baseline mandate this probe fixture was initialised with";
const PROBE_MANDATE = "A mandate the probe supplies, deliberately not the baseline";

/**
 * How to invoke a subcommand against an already-initialised scratch vault.
 *
 * Every *granted* subcommand needs an entry (asserted below) — a new grant
 * arrives with the argument list that lets this file decide it, or it fails.
 * Entries for ungranted subcommands are the controls.
 *
 * `set-outcome`'s text must differ from `BASELINE_MANDATE`: handed the same
 * words it refuses with "identical" and writes nothing, which would classify the
 * one known violation as clean.
 */
const PROBES: Record<string, (vault: string) => string[]> = {
  init: (vault) => ["init", vault, "--outcome", PROBE_MANDATE],
  "set-outcome": (vault) => ["set-outcome", PROBE_MANDATE, "--vault", vault],
  status: (vault) => ["status", "--vault", vault],
};

/** Probed no matter what the command files grant, because they are the controls. */
const CONTROLS = ["set-outcome", "status"] as const;

/** Every `Bash(… <subcommand>:*)` prefix the nine shipped command files grant. */
const GRANTED_SUBCOMMANDS: readonly string[] = (() => {
  const found = new Set<string>();
  for (const file of commandFiles) {
    const line = allowedToolsLine(fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8")) ?? "";
    for (const entry of line.split(",").map((s) => s.trim())) {
      const m = entry.match(BASH_GRANT);
      if (m) found.add(m[1]);
    }
  }
  return [...found].sort();
})();

/** The tree: node files and the config. Deliberately not `.ost-agent/` — see above. */
function treeOf(vault: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of fs.readdirSync(vault, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md") && e.name !== "ost.config.yaml") continue;
    out.set(e.name, createHash("sha256").update(fs.readFileSync(path.join(vault, e.name))).digest("hex"));
  }
  return out;
}

/** Names present in one snapshot and not the other, or whose bytes moved. */
function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((n) => before.get(n) !== after.get(n)).sort();
}

/**
 * Run one subcommand against a fresh, already-initialised vault and report which
 * tree files it moved. Empty means it did not write the tree.
 *
 * `recipe` defaults to the registered one and is only ever passed explicitly by
 * the guard test for the non-zero-exit branch, which needs an invocation that is
 * certain to fail. Every real caller goes through `PROBES`, so the missing-recipe
 * throw below is still reached the way it would be in production use.
 */
async function treeWritesOf(sub: string, recipe: ((vault: string) => string[]) | undefined = PROBES[sub]): Promise<string[]> {
  if (!recipe) throw new Error(`no probe recipe for \`${sub}\``);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ost-w6-${sub}-`));
  try {
    const vault = path.join(tmp, "vault");
    await initVault(vault, BASELINE_MANDATE, "Probe");
    const before = treeOf(vault);
    const r = spawnSync(TSX, [CLI, ...recipe(vault)], { encoding: "utf8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) {
      // Fail loudly rather than returning []. A subcommand that errors out wrote
      // nothing, and "wrote nothing" is exactly the verdict this file must never
      // reach by accident.
      throw new Error(`probe \`${sub}\` exited ${r.status}: ${r.stdout ?? ""}${r.stderr ?? ""}`);
    }
    return changedBetween(before, treeOf(vault));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const treeWrites = new Map<string, string[]>();

beforeAll(async () => {
  for (const sub of new Set<string>([...GRANTED_SUBCOMMANDS, ...CONTROLS])) {
    treeWrites.set(sub, await treeWritesOf(sub));
  }
}, 120_000);

/**
 * Granted subcommands that write the tree — **empty, which is W6 met.**
 *
 * It is not a list that happens to have nothing in it: the idiom is
 * `module-reachability.test.ts`'s debt register, and the assertion is **exact
 * equality in both directions**. Granting a tree-writing subcommand to a shipped
 * command fails the build on the commit that does it, and it can only be made
 * green again by either dropping the grant or writing an entry here that argues
 * for keeping it — which is a diff a reviewer sees. Emptiness is the only state
 * this file calls "met", and it stopped being a promise the moment
 * `Bash(… set-outcome:*)` came off `/ost-setup` (see the block comment above; the
 * argument for why `init:*` is a grant and not a tolerated exception is the test
 * two below).
 *
 * The one thing that must never happen to this object is being widened to make a
 * red build green without that argument. It was carrying `set-outcome` until
 * 2026-07-30, with the steps to close it written out in the entry; those steps
 * were taken, so the entry came off rather than the assertion being loosened.
 */
const GRANTED_TREE_WRITES: Record<string, string> = {};

describe("W6 — no shipped command grants a Bash subcommand that writes the tree", () => {
  test("the grant enumeration found something, and every granted subcommand has a probe", () => {
    // Without this, an enumeration that silently came back empty would make the
    // verdict below vacuously match an empty register.
    expect(GRANTED_SUBCOMMANDS.length).toBeGreaterThan(0);
    expect(GRANTED_SUBCOMMANDS).toContain("init");
    for (const sub of GRANTED_SUBCOMMANDS) {
      expect(
        Object.keys(PROBES),
        `\`${sub}\` is granted to a shipped command but this file has no way to run it, so nothing ` +
          "here knows whether it writes the tree. Add a probe recipe with the argument list it needs.",
      ).toContain(sub);
    }
  });

  test("the differ notices a byte, so an unchanged verdict means something", async () => {
    // The control for the comparison itself: hash-equal snapshots would report
    // "wrote nothing" for every subcommand, including one that rewrote the root.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-w6-differ-"));
    try {
      const vault = path.join(tmp, "vault");
      await initVault(vault, BASELINE_MANDATE, "Probe");
      const before = treeOf(vault);
      expect(changedBetween(before, treeOf(vault))).toEqual([]);
      fs.appendFileSync(path.join(vault, "Probe.md"), "\n");
      expect(changedBetween(before, treeOf(vault))).toEqual(["Probe.md"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("control: `status` is read-only, so the prober is not simply always-red", () => {
    expect(treeWrites.get("status")).toEqual([]);
  });

  test("control: `set-outcome` is caught, so the prober is not simply always-green", () => {
    // Probed by name rather than through the grant list, which is why this control
    // survived the day the grant was dropped — and why it now carries the whole
    // weight of the register being honestly empty rather than emptily green. If
    // the prober ever stops being able to see a tree write, this reds; the
    // register assertion would not.
    expect(treeWrites.get("set-outcome")).toEqual(["Probe.md", "ost.config.yaml"]);
  });

  test("`init` leaves a live tree byte-identical even when handed a different outcome", () => {
    // This is what makes `init:*` an acceptable grant rather than a tolerated
    // one, and it is the load-bearing half of the argument for dropping
    // `set-outcome:*`: first run does not need it.
    expect(treeWrites.get("init")).toEqual([]);
  });

  test("the granted subcommands that write the tree are exactly the registered debt", () => {
    const offenders = Object.fromEntries(
      GRANTED_SUBCOMMANDS.map((s) => [s, treeWrites.get(s) ?? []] as const).filter(([, wrote]) => wrote.length > 0),
    );
    expect(
      Object.keys(offenders).sort(),
      `granted subcommands that wrote the tree: ${JSON.stringify(offenders)}`,
    ).toEqual(Object.keys(GRANTED_TREE_WRITES).sort());
  });

  test("every entry on the register is still granted by a shipped command", () => {
    // A register entry for a grant nobody makes any more is the document being
    // wrong about the repo, which is the failure this whole file exists to stop.
    // Nothing to iterate while the register is empty — which is the point of the
    // assertion that follows it: "empty" has to be an observed fact about this
    // object, not a loop that happened to have no work to do.
    for (const sub of Object.keys(GRANTED_TREE_WRITES)) {
      expect(GRANTED_SUBCOMMANDS, `\`${sub}\` is registered as an open violation but nothing grants it`).toContain(sub);
    }
    expect(
      Object.keys(GRANTED_TREE_WRITES),
      "W6 is recorded as met; an entry here means it is not, and the readiness document has to say so",
    ).toEqual([]);
  });
});

/**
 * The two fail-closed branches of the prober, each proved to fire.
 *
 * Both were argued in prose above and neither had a test, which was survivable
 * only while the register was non-empty: a spurious empty verdict then failed the
 * exact-equality assertion anyway. Now that the register IS empty, an empty
 * verdict is the expected answer, and every route to one by accident — a granted
 * subcommand quietly skipped, a probe that crashed before it could write — is a
 * route to a green build that means nothing.
 */
describe("W6 — the prober cannot reach an empty verdict by accident", () => {
  test("a granted subcommand with no probe recipe throws rather than being skipped", async () => {
    // Any subcommand the CLI defines but this file has no recipe for stands in for
    // tomorrow's new grant. Picked out of the derived set rather than typed, so it
    // cannot name something that stopped existing.
    const unprobed = [...SUBCOMMANDS].find((s) => !(s in PROBES));
    expect(unprobed, "every CLI subcommand has a probe recipe, so this guard has nothing to demonstrate on").toBeDefined();
    await expect(treeWritesOf(unprobed as string)).rejects.toThrow(/no probe recipe/);
  });

  test("a probe that exits non-zero throws rather than reporting `wrote nothing`", async () => {
    // `status` against a directory that is not a vault: the CLI exits 1 having
    // written nothing, which is byte-for-byte indistinguishable from a clean
    // read-only run if the exit status is not checked. That is exactly the shape
    // `set-outcome` had in the `no-outcome` state, where the violation would have
    // been recorded as clean.
    await expect(treeWritesOf("status", (vault) => ["status", "--vault", path.join(vault, "not-a-vault")])).rejects.toThrow(
      /exited/,
    );
  });
});
