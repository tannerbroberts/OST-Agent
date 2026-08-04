/**
 * The skill's tool list and the server's surface agree (readiness criterion **D3**).
 *
 * `.claude/skills/opportunity-solution-tree/SKILL.md` is the file a Claude Code
 * session loads to learn what this product is and what it may do. Its
 * `allowed-tools:` frontmatter is not documentation: under
 * `-p --permission-mode acceptEdits` a call to a tool outside that list is
 * **denied, not prompted**, so a tool the server exposes and the skill omits is
 * a capability the model is told about nowhere and cannot use anyway. The
 * failure is silent by construction — the pass runs, does less, and reports done.
 *
 * Until 2026-07-30 six tools were in that gap — `ost_set_evidence`,
 * `ost_flag_humans_required`, and the four read-only reporters `ost_check`,
 * `ost_debt`, `ost_status`, `ost_gate` — with no recorded reason for any of
 * them, and no test that would have noticed a seventh. All six are granted now;
 * the frontmatter is `MCP_TOOL_NAMES` exactly.
 *
 * What makes this a pin rather than a snapshot:
 *
 * 1. **The expected set is `MCP_TOOL_NAMES` itself**, imported from
 *    `src/mcp/server.ts` — never `OST_RULESET.skillTools`. Comparing the skill
 *    against the list that generates it would be a mirror: both sides would move
 *    together and the test would pass through any drift. Adding a tool to the
 *    server and forgetting the skill fails here.
 * 2. **An omission is allowed, but only out loud.** A name in the surface and
 *    not in the grant must carry `<!-- omitted: <name> — <reason> -->` in the
 *    skill body. Silence is the state this criterion exists to end. Nothing is
 *    withheld today, so that branch is exercised against *constructed* skill
 *    text below rather than left untested until the day someone needs it.
 * 3. **The grant may not invent tools either.** A name in the frontmatter that
 *    the server does not expose is the D2 failure wearing a different hat: it
 *    reads as a capability and resolves to nothing.
 *
 * Scope deliberately left open, because D3 says so: this test reads the tool
 * *list*, never the skill's prose. A skill that names a tool in a sentence and
 * omits it from the frontmatter is invisible here — `test/release/withdrawn-claims.test.ts`
 * is the guard that reads prose, and it exists precisely because a false claim
 * once rode through this blind spot.
 *
 * **Non-vacuity, and how it was proved.** A skill that already agrees with the
 * surface makes the parity assertion green whether or not it compares anything,
 * so the same function is run over mutated copies of the real skill text — a
 * grant deleted, a grant invented, an omission whose reason is a shrug, a tool
 * both granted and omitted — plus a surface carrying a tool the skill has never
 * heard of, which is the drift this criterion actually exists for, and one case
 * that must come back **clean** (a grant withdrawn *with* a stated reason), so
 * that "always red" cannot pass for "discriminating". Confirmed by mutation
 * before this comment was written: making `parityProblems` return `[]`
 * unconditionally turned the five must-report cases red and left the
 * must-not-report case green, so the controls carry the proof and the agreement
 * assertion does not.
 *
 * The prefix check carries its own control rather than borrowing that one: it is
 * run twice in the same test, once with a renamed prefix (which must report
 * every entry) and once with the manifest's own (which must report none), so it
 * cannot pass by complaining about everything. Proved the same way — renaming
 * the `mcpServers` key in `.claude-plugin/plugin.json` and regenerating turned
 * sixteen assertions red across this file and `test/release/command-allowlists.test.ts`,
 * and the manifest was restored byte-for-byte afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SKILL_PATH } from "../../scripts/gen-skill.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { MCP_PREFIX } from "../../scripts/mcp-prefix.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The prefix a session actually mints for this plugin's tools, read off the
 * `mcpServers` key of `.claude-plugin/plugin.json` — the same derivation
 * `test/release/command-allowlists.test.ts` uses on the command files, and the
 * same one `scripts/gen-skill.ts` now renders with.
 *
 * Hardcoding it here (as this file did until 2026-07-30) made the parity check
 * blind to the one edit that voids the whole grant at once: rename the server in
 * the manifest, and every granted name in the skill resolves to nothing — denied
 * rather than prompted, so the model would lose its entire surface silently.
 * With both sides derived, that rename fails here.
 *
 * Deriving locally was not enough. This file, `scripts/gen-skill.ts` and
 * `test/release/command-allowlists.test.ts` each derived it separately and each
 * derived `mcp__<server>__` — the form a directly-registered server mints, not
 * the `mcp__plugin_<plugin>_<server>__` a plugin install produces. Three
 * independent copies of one wrong model read as three confirmations. The single
 * derivation now lives in `scripts/mcp-prefix.ts`.
 */

const skill = fs.readFileSync(SKILL_PATH, "utf8");

/**
 * The tool names the skill grants, parsed the way a reader of the criterion
 * would: the `allowed-tools:` key of the frontmatter (line 5 today), split on
 * commas, prefix stripped.
 */
export function grantedTools(source: string): string[] {
  const line = source.match(/^allowed-tools:\s*(.+)$/m);
  if (!line) throw new Error("SKILL.md has no `allowed-tools` frontmatter key");
  return line[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => (n.startsWith(MCP_PREFIX) ? n.slice(MCP_PREFIX.length) : n));
}

/** Tool names the skill body explicitly declares withheld, with a reason. */
export function reasonedOmissions(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/<!--\s*omitted:\s*(ost_[a-z_]+)\s*—\s*([^>]*?)\s*-->/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/**
 * Every granted name must carry the prefix the manifest mints.
 *
 * Separate from {@link parityProblems} because it fails for a different reason:
 * parity is about *which* tools; this is about whether the names resolve at all.
 * Read the raw frontmatter rather than `grantedTools`, whose whole job is to
 * strip the prefix away.
 */
export function prefixProblems(source: string, prefix: string): string[] {
  const line = source.match(/^allowed-tools:\s*(.+)$/m);
  if (!line) return ["SKILL.md has no `allowed-tools` frontmatter key"];
  return line[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith(prefix))
    .map((entry) => `"${entry}" does not carry ${prefix} — the session will not resolve it to a tool`);
}

/**
 * The criterion, as a function so the mutation controls below can run the same
 * code. Returns the problems; empty means the two surfaces agree.
 */
export function parityProblems(source: string, surface: readonly string[]): string[] {
  const granted = new Set(grantedTools(source));
  const omitted = reasonedOmissions(source);
  const problems: string[] = [];

  for (const tool of surface) {
    if (granted.has(tool)) continue;
    const reason = omitted.get(tool);
    if (!reason) {
      problems.push(`${tool} is on the server's surface, is not granted by the skill, and no <!-- omitted: … --> says why`);
    } else if (reason.length < 20) {
      // A reason short enough to be a shrug is the same silence with punctuation.
      problems.push(`${tool}'s omission reason is too thin to be a reason: "${reason}"`);
    }
  }

  const surfaceSet = new Set(surface);
  for (const tool of granted) {
    if (!surfaceSet.has(tool)) {
      problems.push(`the skill grants ${tool}, which the server does not expose — the grant resolves to nothing`);
    }
  }
  for (const tool of omitted.keys()) {
    if (granted.has(tool)) {
      problems.push(`${tool} is both granted and declared omitted — the skill contradicts itself`);
    }
  }
  return problems;
}

/**
 * Remove one tool from the frontmatter grant, as a hand-edit or a bad
 * regeneration would. Asserts the edit applied — a `replace` that matched
 * nothing would hand every caller below the unmutated file and turn this whole
 * control block into a second copy of the agreement test.
 */
function withdrawGrant(source: string, tool: string): string {
  const out = source.replace(`${MCP_PREFIX}${tool}, `, "").replace(`, ${MCP_PREFIX}${tool}`, "");
  if (out === source) throw new Error(`withdrawGrant(${tool}) matched nothing — the fixture is not a mutation`);
  return out;
}

/** Withdraw a grant and declare the withholding in the body, the sanctioned shape. */
function withOmission(source: string, tool: string, reason: string): string {
  return `${withdrawGrant(source, tool)}\n<!-- omitted: ${tool} — ${reason} -->\n`;
}

describe("the skill's tool list and the server's surface agree (D3)", () => {
  test("the parse finds a real grant on the frontmatter line the criterion names", () => {
    // Anti-vacuity for the parser itself: an empty or unparsed list would make
    // every "granted" assertion below trivially false and every "omitted"
    // assertion trivially loud, so pin that the list is real and where D3 says.
    const granted = grantedTools(skill);
    expect(granted.length).toBeGreaterThanOrEqual(17);
    expect(skill.split("\n")[4]).toMatch(/^allowed-tools:/);
    expect(granted).toContain("ost_next_work");
  });

  test("every tool the server exposes is granted, or its absence carries a reason", () => {
    expect(parityProblems(skill, MCP_TOOL_NAMES)).toEqual([]);
  });

  test("every granted name carries the prefix the plugin manifest mints", () => {
    // The failure this catches is not a wrong tool but a wrong *namespace*, and
    // it takes the whole surface down in one edit rather than one tool at a
    // time — which is why it is asserted separately from parity.
    expect(prefixProblems(skill, MCP_PREFIX)).toEqual([]);
    expect(MCP_PREFIX).toMatch(/^mcp__.+__$/);
  });

  test("nothing is withheld today — the grant is the surface, exactly", () => {
    // D3 allows either branch. This pins which branch the repo is actually on,
    // so that a future omission is a deliberate edit to this test rather than a
    // silent slide back into the state D3 was written against. `toEqual` over
    // sorted arrays rather than a subset check in each direction: a grant that
    // drifts either way — a tool dropped, a tool invented — fails here.
    expect([...grantedTools(skill)].sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect([...reasonedOmissions(skill).keys()]).toEqual([]);
  });

  test("the six that were silently missing are now granted", () => {
    // Named individually rather than left to the set comparison above: each was
    // a separate decision, and naming them is what makes a later removal read as
    // a reversal instead of as a tidy-up.
    //
    // The four reporters read the tree's health back — a skill that tells the
    // model to keep a tree honest while withholding every tool that reports
    // whether it is was the original defect. `ost_set_evidence` is already
    // granted on `/ost-pass` under R7 and refused above its earned ceiling at
    // the write boundary under B3, so it reaches nothing new.
    //
    // `ost_flag_humans_required` was the sixth and the contested one. It was
    // withheld for a day on the wedge R2 names — filing the flag against a test
    // whose own prose claims another lane used to leave a `lane-conflict`
    // nothing on this surface could clear. R2 closed that at the boundary and
    // `test/eval/clearability.test.ts` now pins the refusal green on the **mcp**
    // surface, which is `MCP_TOOL_NAMES` entire, this tool included. Two-call
    // authorship was probed as well, since that table is explicit that a `false`
    // cell means the declared single attempt failed and not that no sequence
    // could: flag-then-append cannot manufacture the contradiction, because the
    // flag's own History entry introduces a `## ` heading and `ownProse` stops
    // at the first one.
    const granted = grantedTools(skill);
    for (const tool of ["ost_check", "ost_debt", "ost_status", "ost_gate", "ost_set_evidence", "ost_flag_humans_required"]) {
      expect(granted, `${tool} should be granted`).toContain(tool);
    }
  });

  test("a skill grant is not a command grant — /ost-pass's frontmatter is untouched", () => {
    // R3's clearability table and R7 both read `.claude/commands/ost-pass.md`,
    // not this file, and the two are compared by nothing. Pinned here because
    // the grant above is exactly the kind of change a later reader would assume
    // widened the unattended sweep: it did not. R7's containment argument —
    // `ost_flag_humans_required` is on no shipped command — is what this
    // assertion holds in place now that the skill no longer holds it too.
    // The *frontmatter*, not the file: `ost-pass.md`'s prose names `ost_check`
    // when it explains that an annotated hygiene issue leaves the other gate
    // red. Naming a tool in a sentence is not granting it, which is the same
    // distinction this whole file turns on.
    const pass = fs.readFileSync(new URL("../../.claude/commands/ost-pass.md", import.meta.url), "utf8");
    const passGrants = grantedTools(pass);
    expect(passGrants).not.toContain("ost_flag_humans_required");
    expect(passGrants).not.toContain("ost_check");
    // Control: the parse of that file is real, so the two negatives above are
    // not both passing because `passGrants` came back empty.
    expect(passGrants).toContain("ost_set_evidence");
  });
});

describe("the parity check reports a skill that disagrees with the surface", () => {
  test("a granted tool silently dropped is reported", () => {
    const mutated = withdrawGrant(skill, "ost_read_tree");
    expect(parityProblems(mutated, MCP_TOOL_NAMES).join("\n")).toMatch(/ost_read_tree.*no <!-- omitted/);
  });

  test("a tool added to the server and forgotten in the skill is reported", () => {
    // The drift this criterion exists for, simulated on the side that actually
    // moves: the server grows a tool, nobody regenerates the skill.
    const problems = parityProblems(skill, [...MCP_TOOL_NAMES, "ost_new_capability"]);
    expect(problems.join("\n")).toMatch(/ost_new_capability.*no <!-- omitted/);
  });

  test("a grant withdrawn WITH a stated reason is accepted — the sanctioned branch still works", () => {
    // The must-not-report case, and the reason the five must-report cases mean
    // anything: a `parityProblems` that returned a complaint for everything
    // would satisfy them all and would still be a broken criterion. This is
    // also the only exercise the omission branch gets, since nothing is
    // withheld in the shipped skill today.
    const mutated = withOmission(
      skill,
      "ost_read_repo",
      "reading the product's own source is out of scope for this surface until the confinement in `product.repos` is pinned by a test",
    );
    expect(parityProblems(mutated, MCP_TOOL_NAMES)).toEqual([]);
    expect(reasonedOmissions(mutated).get("ost_read_repo")).toMatch(/out of scope/);
  });

  test("an omission reason too thin to be a reason is reported", () => {
    const mutated = withOmission(skill, "ost_read_repo", "later");
    expect(parityProblems(mutated, MCP_TOOL_NAMES).join("\n")).toMatch(/too thin to be a reason/);
  });

  test("a granted tool the server does not expose is reported", () => {
    const mutated = skill.replace("allowed-tools: ", `allowed-tools: ${MCP_PREFIX}ost_delete_node, `);
    expect(mutated, "the mutation did not apply").not.toBe(skill);
    expect(parityProblems(mutated, MCP_TOOL_NAMES).join("\n")).toMatch(/ost_delete_node.*does not expose/);
  });

  test("a skill left on the old prefix after the server was renamed is reported", () => {
    // The manifest edit, simulated from the other side: the skill still says
    // `mcp__plugin_ost-agent_ost-agent__…` while the session mints `mcp__ost-tree__…`. Both
    // checks must notice — the prefix check by name, and parity because the
    // unstripped entries are then eighteen tools the server does not expose.
    const renamed = "mcp__ost-tree__";
    expect(prefixProblems(skill, renamed).length).toBe(MCP_TOOL_NAMES.length);
    expect(prefixProblems(skill, renamed).join("\n")).toMatch(/does not carry mcp__ost-tree__/);
    // Control: the same call with the real prefix returns nothing, so the line
    // above is not passing because `prefixProblems` complains about everything.
    expect(prefixProblems(skill, MCP_PREFIX)).toEqual([]);
  });

  test("granting and omitting the same tool is reported", () => {
    const mutated = `${skill}\n<!-- omitted: ost_annotate — held back while the hygiene wording is being rewritten -->\n`;
    expect(parityProblems(mutated, MCP_TOOL_NAMES).join("\n")).toMatch(/both granted and declared omitted/);
  });
});
