/**
 * What the build loop runs, and what it tells the operator when it runs nothing.
 *
 * Two failures live behind this file, both observed rather than imagined.
 *
 * **The script stopped parsing.** The build prompt was assembled with
 * `BUILD_PROMPT="$(cat <<PROMPT …)"`, and inside command substitution bash parses
 * the heredoc body for quote pairs — so one apostrophe in ordinary English ("a
 * human's finding") was an unterminated string that killed the file at parse
 * time. Every due firing exited 2 before line one, which meant it could not even
 * write a report saying it had died: the operator saw the previous run's report
 * sitting on screen, looking current, for hours. A `bash -n` check is cheap and
 * would have caught it the moment it was written.
 *
 * **The report asked the operator to do the tree's work.** On a tree with nothing
 * buildable, the no-build branch told the reader to go run an assumption test and
 * file a result with `ost-agent result`. That is discovery's business, not a
 * build loop's, and it went out hourly — the fastest way to teach someone to
 * ignore a channel is to make it nag them for work they did not ask this loop
 * about. Worse, it named the one unblock that needs a human at the exact moment
 * the loop had gained one that needs nobody.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPTS = ["examples/automation/build-pass.sh", "examples/automation/autonomous-pass.sh"];

describe("the automation scripts parse", () => {
  test.each(SCRIPTS)("%s is syntactically valid bash", (script) => {
    // `bash -n` reads the whole file and runs none of it. A parse error here is a
    // firing that dies before it can report, which is the one failure mode an
    // unattended loop cannot tell anyone about.
    expect(() => execFileSync("bash", ["-n", path.join(root, script)], { stdio: "pipe" })).not.toThrow();
  });

  test("the build prompt is not built inside command substitution", () => {
    const source = fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8");
    // Asserted against the code, not the file: the comment above this construct
    // quotes it verbatim to explain why it is gone, and a check that read the
    // prose would fail on the explanation of its own fix.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    // The specific construct that broke: a heredoc inside `$( )`, where prose
    // apostrophes are parsed as quotes. A plain redirect to a file is not.
    expect(code).not.toMatch(/BUILD_PROMPT="\$\(cat <<PROMPT/);
    expect(code).toMatch(/cat >"\$PROMPT_FILE" <<PROMPT/);
  });

  test("prose in the prompt may contain apostrophes — the regression that broke it", () => {
    const source = fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8");
    const prompt = source.slice(source.indexOf('cat >"$PROMPT_FILE" <<PROMPT'), source.indexOf("\nPROMPT\n"));
    // Non-vacuity: if the prompt ever stopped containing an odd apostrophe, this
    // file would still pass while no longer covering the thing that broke.
    expect(prompt.split("'").length - 1).toBeGreaterThan(0);
  });
});

describe("the no-build report never asks the operator to do tree work", () => {
  const source = fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8");
  /** The `report "…"` strings on the nothing-to-build path. */
  const reports = [...source.matchAll(/report "([^"]+)"/g)].map((m) => m[1]);

  test("the script still reports on every exit path", () => {
    expect(reports.length).toBeGreaterThanOrEqual(4);
  });

  /*
   * Each phrase below is an instruction to go and change the tree. The build loop
   * is the half that may not touch the tree; telling a human to touch it on the
   * loop's behalf is the same coupling wearing a different hat, and it is the
   * text that actually shipped.
   */
  test.each([
    ["ost-agent result", /ost-agent result/],
    ["ost-agent lanes", /ost-agent lanes/],
    ["run an assumption test", /run an assumption test/i],
    ["records what happened", /records? what happened/i],
  ])("no report tells the operator to %s", (_label, pattern) => {
    const offenders = reports.filter((r) => pattern.test(r));
    expect(offenders, `a build-loop report asks for tree work: ${offenders.join(" | ")}`).toEqual([]);
  });

  /*
   * The regression that prompted this block. The prose-only branch asserted "The
   * discovery loop is working through exactly that queue ... No action needed"
   * unconditionally, and shipped that hourly for 21 hours while discovery had not
   * fired once, parked over its spend ceiling. The claim was never checked
   * against anything.
   */
  test("the discovery-is-working claim is conditional, never unconditional", () => {
    const source2 = fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8");
    const code = source2
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    // It must consult something before reassuring anyone.
    expect(code).toMatch(/loop health --vault/);
    // And the reassurance must sit in a branch, not in the open.
    const reassuring = [...code.matchAll(/report "([^"]*firing on schedule[^"]*)"/g)];
    expect(reassuring.length, "the reassuring report should exist and be branch-guarded").toBe(1);
    expect(code).toMatch(/if \[ -n "\$BLOCKED" \]/);
    expect(code).toMatch(/LAST_MIN" -gt "\$QUIET_AFTER_MIN/);
  });

  test("a blocked or silent discovery loop is named, not papered over", () => {
    const reports2 = [...fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8").matchAll(/report "([^"]+)"/g)].map(
      (m) => m[1],
    );
    // One report for "discovery is blocked, here is why", one for "discovery has
    // gone quiet". Neither may end by telling the operator no action is needed.
    const blocked = reports2.filter((r) => /is NOT running/.test(r));
    const quiet = reports2.filter((r) => /has not fired in/.test(r));
    expect(blocked.length).toBe(1);
    expect(quiet.length).toBe(1);
    for (const r of [...blocked, ...quiet]) {
      expect(r, `a report about a stalled discovery loop must not say no action is needed: ${r}`).not.toMatch(
        /No action needed/i,
      );
    }
  });

  test("the nothing-to-build reports say who WILL change it, and ask for nothing", () => {
    const idle = reports.filter((r) => /built nothing/.test(r));
    expect(idle.length).toBeGreaterThanOrEqual(3);
    // Every idle report either names the machine that will unblock it or says
    // outright that nothing is needed. A report that does neither leaves the
    // reader to infer whether they are being asked for something.
    for (const r of idle) {
      expect(r, `this idle report neither reassures nor names the next actor: ${r}`).toMatch(
        /No action needed|Nothing is required of you|no tree work is being asked of you|discovery/i,
      );
    }
  });
});

describe("the loop runs the instruments, and the model does not", () => {
  const source = fs.readFileSync(path.join(root, SCRIPTS[0]), "utf8");
  const executable = source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  test("the preflight verifies pending instruments itself — no human in the middle", () => {
    expect(executable).toMatch(/buildable --pending/);
    expect(executable).toMatch(/verify "\$test_title"/);
  });

  test("verification is capped, and what was skipped is named rather than dropped", () => {
    expect(executable).toMatch(/VERIFY_CAP/);
    // The note is assembled into a variable the report interpolates, so it is
    // asserted against the code rather than against the `report "…"` literals.
    expect(executable).toMatch(/queued for the next firing/);
    expect(executable).toMatch(/CAP_NOTE/);
  });

  test("the model is told not to record observations", () => {
    // The reserved-heading guard stops the MCP surface writing one; that is worth
    // nothing if the shell hands the same capability over through Bash.
    expect(source).toMatch(/Do NOT run 'ost-agent verify' yourself/);
  });

  test("every candidate is re-checked before it becomes a build target", () => {
    // The observed failure: `buildable`'s advisory went to stdout, the script's
    // filter kept it, and the sentence "nothing is buildable…" was handed to a
    // build pass as the solution it had been cleared to build — a permit
    // invented by a grep. Re-asking `buildable <title>` makes an unparseable
    // line fail its own check instead of becoming work.
    expect(executable).toMatch(/buildable "\$sol" --vault \./);
    expect(executable).toMatch(/ignoring unparseable candidate/);
  });

  test("the postflight checks the build against the command, not against the report", () => {
    expect(executable).toMatch(/BUILD_OBSERVED/);
    expect(executable).toMatch(/still red/);
  });

  test("observations are committed, or the discovery loop wedges on a dirty vault", () => {
    // `loop start` refuses a dirty tree, so a tree write this loop leaves behind
    // silently stops the other loop from ever firing again.
    expect(executable).toMatch(/git -C "\$VAULT_DIR" -c user\.name="ost-build-loop"[\s\S]{0,120}commit/);
  });

  test("the commit names the file it wrote and never sweeps the vault", () => {
    // The two loops hold separate locks and neither waits on the other, so
    // discovery can be mid-firing in this vault. A blanket stage would commit a
    // stranger's in-flight work under this loop's message.
    expect(executable).toMatch(/git -C "\$VAULT_DIR" add -- "\$\{test_title\}\.md"/);
    expect(executable).toMatch(/git -C "\$VAULT_DIR" add -- "\$\{TARGET_TEST\}\.md"/);
    expect(executable).not.toMatch(/git -C "\$VAULT_DIR" add -A/);
    expect(executable).not.toMatch(/git -C "\$VAULT_DIR" add -- '\*\.md'/);
  });
});

/**
 * The arrow prefix, and the one thing it is allowed to mean.
 *
 * A build report opens with the Outcome→…→solution path, so the operator reads
 * where the work sits before reading what happened to it. The design decision
 * worth pinning is not that the prefix exists but that it is CONDITIONAL: most
 * firings build nothing, and a root-only prefix on twenty reports out of
 * twenty-one teaches the reader to skip the first line, after which the prefix
 * is worth nothing on the firing that matters.
 *
 * So an arrow prefix means "this pass touched a specific node" and nothing else.
 * The rejected alternative — prefixing idle reports with the next candidate —
 * would put a node in the report that the pass never touched, which is the same
 * defect as the "discovery is working through that queue" line that went out
 * hourly for twenty-one hours against a loop that had not fired.
 */
describe("the lineage prefix means the pass touched a node", () => {
  const script = fs.readFileSync(path.join(root, "examples/automation/build-pass.sh"), "utf8");

  test("LINEAGE starts empty and is only filled once a target is chosen", () => {
    expect(script).toMatch(/^LINEAGE=""$/m);
    const init = script.search(/^LINEAGE=""$/m);
    const selection = script.search(/^TARGET=""$/m);
    const filled = script.search(/^LINEAGE="\$\(node "\$CLI" lineage/m);
    expect(selection).toBeGreaterThan(init);
    expect(filled).toBeGreaterThan(selection);
  });

  test("nothing sets TARGET after the lineage is read, so the prefix names what was built", () => {
    // The candidate that heads the list may turn out to be already built, so the
    // target is now CHOSEN by a loop rather than read off line one. The property
    // the prefix rests on is unchanged and is what this asserts: every write to
    // TARGET happens before `lineage` is asked about it.
    const filled = script.search(/^LINEAGE="\$\(node "\$CLI" lineage/m);
    const writes = [...script.matchAll(/^\s*TARGET=/gm)].map((m) => m.index!);
    expect(writes.length).toBeGreaterThan(1);
    for (const at of writes) expect(at).toBeLessThan(filled);
  });

  test("every no-build branch returns before a target exists, so idle reports carry no prefix", () => {
    // The structural guarantee, rather than a promise about the branches: both
    // no-build blocks exit before the lineage is read. The second one is newer —
    // a list whose every candidate has already been built is an idle firing that
    // reaches further into the script than the empty-list case does.
    const zeroBranch = script.indexOf('if [ "$BUILD_COUNT" -eq 0 ]; then');
    const selection = script.search(/^TARGET=""$/m);
    const nothingLeft = script.indexOf('if [ -z "$TARGET" ]; then');
    const filled = script.search(/^LINEAGE="\$\(node "\$CLI" lineage/m);
    expect(zeroBranch).toBeGreaterThan(-1);
    expect(selection).toBeGreaterThan(zeroBranch);
    expect(script.slice(zeroBranch, selection)).toMatch(/^\s*exit 0$/m);
    expect(nothingLeft).toBeGreaterThan(selection);
    expect(nothingLeft).toBeLessThan(filled);
    expect(script.slice(nothingLeft, filled)).toMatch(/^\s*exit 0$/m);
  });

  test("the model's own report gets the prefix too — it Writes the file itself", () => {
    // `report()` cannot cover this: the prompt tells the model to Write $REPORT,
    // which replaces whatever the shell put there.
    expect(script).toMatch(/^prefix_lineage\(\)/m);
    const call = script.lastIndexOf("\nprefix_lineage\n");
    const claudeCall = script.indexOf('claude -p "$(cat "$PROMPT_FILE")"');
    expect(claudeCall).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(claudeCall);
  });

  test("prefixing is idempotent, because the postflight rewrites the report on one branch", () => {
    expect(script).toMatch(/case "\$\(head -1 "\$REPORT"\)" in "\$LINEAGE"\) return 0/);
  });

  test("an unreachable node degrades to no prefix rather than a bare arrow", () => {
    expect(script).toMatch(/lineage "\$TARGET" --vault \. 2>\/dev\/null \|\| true/);
  });
});
