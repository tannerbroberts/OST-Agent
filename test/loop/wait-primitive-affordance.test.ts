/**
 * "Measure whether the permitted wait is actually more expensive to write than
 * the blocked one" — the assumption test under *Offer the permitted form at the
 * moment of reach*, held at the threshold it states:
 *
 *   > For each of the three observed waiting cases, the permitted form is no
 *   > longer to express than the blocked form it replaces.
 *
 * It is a **disconfirmer aimed at the node's premise, not at its mechanism**. The
 * node asserts that `sleep 45; gh pr checks 17` keeps being written because it is
 * the shortest way to say "wait for this". If the form the guard asks for were
 * already no longer to write, expression cost is not what drives the repeat and
 * the whole candidate is aimed at the wrong cause. So this file measures two
 * things and reports both:
 *
 *   1. **The baseline** — what the guard's own named remedies cost today. That is
 *      the premise, and it is the half that could have killed the build.
 *   2. **The threshold** — what the form this repository now ships costs. That is
 *      the definition of done.
 *
 * ## The one decision that decides the answer
 *
 * A comparison like this is trivially riggable through the choice of what the
 * permitted form is allowed to *not* do. Pick a narrow condition by hand and the
 * permitted form gets arbitrarily short; the `condition` case's blocked command
 * carries a 118-character path twice, and against a hand-picked `wc -l <path>`
 * probe the guard's plain until-loop already comes out **cheaper** than the
 * command it replaces — the premise refuted, on a comparison in which the
 * replacement silently dropped two thirds of the output the composer asked for.
 *
 * So nothing here is hand-picked. `peekOf` strips the fixed sleep and `probeOf`
 * additionally strips the output-shaping the shim supplies itself; both are
 * mechanical functions of the verbatim blocked string, every permitted form is
 * required to still produce the peek, and `the derivation is mechanical, and
 * hand-narrowing it is what flips the answer` below asserts the flip explicitly
 * so a future author cannot reintroduce the flattering version quietly.
 *
 * ## What this can and cannot settle
 *
 * It can refute the premise; it cannot confirm the mechanism. Characters are a
 * proxy for "longer, less obvious, and has to be recalled" and they only cover
 * the first term. Whether a cheaper form sitting on `PATH` actually changes what
 * a session writes is a question only later sessions answer — the node concedes
 * exactly this, and a green run here does not touch it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { emptyCorrectionsLedger, renderCorrections, type Correction } from "../../src/loop/corrections.js";
import {
  DEFAULT_EVERY_SECONDS,
  DEFAULT_FOR_SECONDS,
  DEFAULT_LINES,
  OBSERVED_PERMITTED,
  SHIM_NAME,
  WAITING_CASES,
  blockedCall,
  expressionCost,
  guardLoop,
  guardRemedies,
  peekOf,
  permittedCall,
  permittedWait,
  probeOf,
  renderWaitAffordance,
  renderWaitShim,
  type WaitingCase,
} from "../../src/loop/wait.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const CORPUS = path.join(repoRoot, "test/fixtures/corrections");

/** Every `Bash` command in the corpus, with the session it was written in. */
function corpusCommands(): { session: string; command: string }[] {
  const out: { session: string; command: string }[] = [];
  for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith(".jsonl"))) {
    const session = file.slice(0, 8);
    for (const line of fs.readFileSync(path.join(CORPUS, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const entry = JSON.parse(line) as { message?: { content?: unknown } };
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as { type?: string; name?: string; input?: { command?: string } }[]) {
        if (block.type === "tool_use" && typeof block.input?.command === "string") {
          out.push({ session, command: block.input.command });
        }
      }
    }
  }
  return out;
}

/** Every refusal text in the corpus, so a claim about the guard can be checked. */
function corpusRefusals(): string[] {
  const out: string[] = [];
  for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(CORPUS, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      if (line.includes("tool_use_error")) out.push(line);
    }
  }
  return out;
}

describe("the subject is what was written, not a tidied-up version of it", () => {
  test.each(WAITING_CASES.map((c) => [c.id, c] as const))(
    "%s — the blocked form is verbatim in the session it was refused in",
    (_id, c: WaitingCase) => {
      const written = corpusCommands().filter((x) => x.session === c.session);
      expect(
        written.map((x) => x.command),
        `the blocked form for "${c.id}" is not in session ${c.session} any more — a case whose command ` +
          "drifted is measuring something nobody wrote",
      ).toContain(c.blocked);
    },
  );

  test("each blocked form was actually refused by the sleep guard", () => {
    const refusals = corpusRefusals().join("\n");
    for (const c of WAITING_CASES) {
      // The refusal quotes the sleep and the commands that followed it, so the
      // duration is the checkable fragment that ties refusal to command.
      const sleep = /^sleep\s+(\d+)/.exec(c.blocked)?.[1];
      expect(sleep, `"${c.id}" does not open with a fixed sleep`).toBeDefined();
      expect(refusals).toContain(`Blocked: sleep ${sleep} followed by`);
    }
  });

  test("the one permitted form a session actually wrote is verbatim too", () => {
    const written = corpusCommands().filter((x) => x.session === OBSERVED_PERMITTED.session);
    expect(written.map((x) => x.command)).toContain(OBSERVED_PERMITTED.call.input.command);
  });

  test("no session in the corpus ever answered the refusal with Monitor", () => {
    // The guard names `Monitor` first. Whether it was reachable is not something
    // this repository can settle; what the corpus settles is that across all eight
    // sightings not one session used it. A remedy nobody takes is a remedy whose
    // price nobody paid, which is why the baseline below leads with the Bash form.
    const refusals = corpusRefusals().join("\n");
    expect(refusals).toContain("use Monitor with an until-loop");
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith(".jsonl"));
    const monitorCalls = files.flatMap((f) =>
      fs
        .readFileSync(path.join(CORPUS, f), "utf8")
        .split("\n")
        .filter((l) => l.includes('"name": "Monitor"') || l.includes('"name":"Monitor"')),
    );
    expect(monitorCalls).toEqual([]);
  });
});

describe("the premise — is the permitted form really more expensive today?", () => {
  test.each(WAITING_CASES.map((c) => [c.id, c] as const))(
    "%s — every form the guard names costs more than the call it refused",
    (_id, c: WaitingCase) => {
      const blocked = expressionCost(blockedCall(c));
      for (const remedy of guardRemedies(c)) {
        expect(
          expressionCost(remedy),
          `${c.id}: the guard's ${remedy.tool} remedy costs ${expressionCost(remedy)} against the blocked ` +
            `call's ${blocked}. If this is ever <= blocked, expression cost is NOT what drives the repeat ` +
            "and the affordance below is aimed at the wrong cause — say so rather than deleting this line.",
        ).toBeGreaterThan(blocked);
      }
    },
  );

  test("and the one that was actually written cost 2.6x the call it replaced", () => {
    const ciCheck = WAITING_CASES.find((c) => c.id === "ci-check");
    expect(ciCheck).toBeDefined();
    const blocked = expressionCost(blockedCall(ciCheck!));
    const observed = expressionCost(OBSERVED_PERMITTED.call);
    expect(blocked).toBe(51);
    expect(observed).toBe(135);
    expect(observed / blocked).toBeGreaterThan(2.5);
  });

  test("the derivation is mechanical, and hand-narrowing it is what flips the answer", () => {
    // The negative control for the whole comparison. `condition` is the case
    // where the two readings disagree: against the mechanically derived probe the
    // guard's loop is dearer, and against a hand-picked one-line probe it is
    // cheaper. Both numbers are true; only the first is an answer to the question
    // the node asked, because only the first still shows the composer what the
    // blocked command would have shown.
    const c = WAITING_CASES.find((x) => x.id === "condition");
    expect(c).toBeDefined();
    const blocked = expressionCost(blockedCall(c!));

    expect(peekOf(c!.blocked)).toBe(c!.blocked.replace(/^sleep 240; /, ""));
    expect(probeOf(c!.blocked)).toBe(peekOf(c!.blocked));
    expect(expressionCost({ tool: "Bash", input: { command: guardLoop(c!), run_in_background: true } }))
      .toBeGreaterThan(blocked);

    const handPicked =
      "wc -l /Users/tanner/.claude/projects/-Users-tanner-dev-OST-Agent/" +
      "470cb94a-d709-43b1-85aa-dedd917ac866/subagents/workflows/wf_452ccb28-61c/journal.jsonl";
    expect(c!.blocked).toContain(handPicked);
    const flattering = {
      tool: "Bash",
      input: { command: `until ${handPicked}; do sleep 5; done`, run_in_background: true },
    };
    expect(
      expressionCost(flattering),
      "a hand-picked probe no longer makes the guard's remedy look cheap — if the blocked commands changed, " +
        "recheck which reading this comparison is using before trusting the green above",
    ).toBeLessThan(blocked);
  });

  test("the output-shaping strip is what it says and no more", () => {
    expect(probeOf("sleep 45; gh pr checks 17 2>&1 | head")).toBe("gh pr checks 17");
    expect(probeOf("sleep 5; ls /x 2>/dev/null | head -20")).toBe("ls /x");
    expect(probeOf("sleep 5 && ls /x | tail -3")).toBe("ls /x");
    // Nothing that is not output-shaping is touched.
    expect(probeOf("sleep 5; a | wc -l")).toBe("a | wc -l");
    expect(probeOf("gh pr checks 17")).toBe("gh pr checks 17");
  });
});

describe("the threshold — the permitted form this repository ships", () => {
  test.each(WAITING_CASES.map((c) => [c.id, c] as const))(
    "%s — no longer to express than the blocked form it replaces",
    (_id, c: WaitingCase) => {
      const blocked = expressionCost(blockedCall(c));
      const permitted = expressionCost(permittedCall(c));
      expect(
        permitted,
        `${c.id}: the permitted form costs ${permitted} against the blocked call's ${blocked}`,
      ).toBeLessThanOrEqual(blocked);
    },
  );

  test("the saving comes from the prefix and the shaping, and both are real", () => {
    // Stated as arithmetic rather than left implicit, because the margin is thin
    // and a reader is entitled to know it is not an accounting trick. `await '` +
    // `'` is eight characters; `sleep 45; ` is ten; the rest is `2>&1 | head -20`
    // the shim supplies itself.
    expect(SHIM_NAME).toHaveLength(5);
    expect(permittedWait("gh pr checks 17")).toBe("await 'gh pr checks 17'");
    expect(permittedWait("echo 'hi'")).toBe("await 'echo '\\''hi'\\'''");

    const margins = WAITING_CASES.map((c) => expressionCost(blockedCall(c)) - expressionCost(permittedCall(c)));
    expect(margins).toEqual([14, 25, 3]);
  });

  test("a longer name would lose the comparison, which is why the shim is on PATH", () => {
    // The claim the node rests on is about *reach*, and reach is spelled here.
    // The margins above are 14, 25 and 3 characters, so the affordance clears the
    // threshold on all three cases only because its name is five characters:
    // `ost-agent wait` costs nine more and loses the `condition` case, and the
    // invocation this project actually documents loses every case by a mile.
    // A subcommand would have been a preference, not an affordance.
    const worst = WAITING_CASES.find((c) => c.id === "condition")!;
    const blocked = expressionCost(blockedCall(worst));
    const subcommand = {
      tool: "Bash",
      input: { command: `ost-agent wait '${probeOf(worst.blocked)}'` },
    };
    expect(expressionCost(subcommand)).toBeGreaterThan(blocked);

    for (const c of WAITING_CASES) {
      const documented = {
        tool: "Bash",
        input: { command: `node "$CLAUDE_PLUGIN_ROOT/dist/ost-agent.mjs" wait '${probeOf(c.blocked)}'` },
      };
      expect(expressionCost(documented)).toBeGreaterThan(expressionCost(blockedCall(c)));
    }

    const script = fs.readFileSync(path.join(repoRoot, "examples/automation/build-pass.sh"), "utf8");
    expect(script, "the build pass must install the shim, or the number above prices a form nobody can write")
      .toContain('node "$CLI" wait-shim');
    expect(script).toContain(`chmod +x "$SHIM_DIR/${SHIM_NAME}.tmp"`);
    expect(script).toContain('PATH="$SHIM_DIR:$PATH"');
    expect(script).toContain("export PATH");
  });
});

describe("the shim is a working wait, not a string that measures well", () => {
  function installShim(): { dir: string; bin: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-await-"));
    const bin = path.join(dir, SHIM_NAME);
    fs.writeFileSync(bin, renderWaitShim(), { mode: 0o755 });
    return { dir, bin };
  }

  function run(args: string[]): { status: number; stdout: string; stderr: string } {
    const { bin } = installShim();
    try {
      const stdout = execFileSync("sh", [bin, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  test("a condition that is already true returns immediately, with its output", () => {
    const started = Date.now();
    const r = run(["echo ready"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("ready");
    // The behavioural difference from the reflex: six of the eight sightings paid
    // a fixed sleep before looking even once. This pays none.
    expect(Date.now() - started).toBeLessThan(DEFAULT_EVERY_SECONDS * 1000);
  });

  test("a condition that never holds gives up on the bound rather than hanging", () => {
    const r = run(["exit 3", "1", "2"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("gave up after");
  });

  test("a condition that becomes true is waited for, and stderr is merged in", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-await-flag-"));
    const flag = path.join(dir, "flag");
    // Second attempt succeeds: the first creates the flag and fails, so a shim
    // that only ever looked once would come back nonzero here.
    const cond = `if [ -f ${JSON.stringify(flag)} ]; then echo arrived >&2; else : >${JSON.stringify(flag)}; exit 1; fi`;
    const r = run([cond, "1", "10"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("arrived");
  });

  test("output is trimmed to the tail the affordance advertises", () => {
    const r = run([`seq 1 ${DEFAULT_LINES * 2}`]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(DEFAULT_LINES);
    expect(lines[lines.length - 1]).toBe(String(DEFAULT_LINES * 2));
  });

  test("naming no condition is refused rather than waited on", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("name the condition");
  });

  test("the shim needs nothing but sh — no node, no bundle path to go stale", () => {
    const shim = renderWaitShim();
    expect(shim.startsWith("#!/bin/sh\n")).toBe(true);
    expect(shim).not.toContain("node ");
    expect(shim).not.toContain("ost-agent.mjs");
  });
});

describe("at the moment of reach — the affordance travels with the correction", () => {
  function ledgerWith(permitted: string) {
    const correction: Correction = {
      id: "to-wait-for-a-condition-use-monitor-with-an",
      permitted,
      attempted: "Blocked: sleep 45 followed by: gh pr checks 17 head.",
      tools: ["Bash"],
      sessions: ["516fdfb8"],
      occurrences: 8,
      firstSeen: "2026-08-01T00:00:00.000Z",
      lastSeen: "2026-08-05T00:00:00.000Z",
    };
    return { ...emptyCorrectionsLedger(), corrections: [correction] };
  }

  test("a waiting correction is delivered with the line to write, not only the rule", () => {
    const text = renderCorrections(
      ledgerWith(
        "To wait for a condition, use Monitor with an until-loop (e.g. `until <check>; do sleep 2; done`). " +
          "To wait for a command you started, use run_in_background: true.",
      ),
    );
    for (const c of WAITING_CASES) {
      expect(text).toContain(permittedWait(probeOf(c.blocked)));
    }
    expect(text).toContain(String(DEFAULT_FOR_SECONDS));
  });

  test("a correction about something else carries no waiting advice", () => {
    const text = renderCorrections(ledgerWith("Use the Read tool instead of cat."));
    expect(text).not.toContain(renderWaitAffordance());
    expect(text).not.toContain(`${SHIM_NAME} '`);
  });

  test("the affordance names all three shapes this workspace has been refused for", () => {
    const affordance = renderWaitAffordance();
    for (const c of WAITING_CASES) expect(affordance).toContain(c.intent);
  });
});
