/**
 * The per-edit half of "Typecheck the files just touched, at the moment they are
 * touched": the command a write boundary calls, and the one caller of
 * {@link ../src/runner/incremental-typecheck.ts}.
 *
 * ```bash
 * npm run typecheck:touched -- src/security/tools.ts
 * npx tsx scripts/typecheck-touched.ts src/a.ts src/b.ts   # a batch of edits
 * ```
 *
 * It also reads a Claude Code `PostToolUse` payload on stdin — `{"tool_input":
 * {"file_path": "…"}}` — because that is the shape the edit result actually
 * arrives in, and a check that needs a human to retype the path it was just
 * handed is not a per-edit check. Wiring is one entry in `.claude/settings.json`:
 *
 * ```json
 * { "hooks": { "PostToolUse": [ { "matcher": "Edit|Write",
 *     "hooks": [ { "type": "command",
 *                  "command": "npx tsx scripts/typecheck-touched.ts" } ] } ] } }
 * ```
 *
 * **It is not wired in this repository, and that is deliberate.** The assumption
 * test beneath the node says in as many words what a green run does not settle:
 * *"it says nothing about the false-positive rate mid-refactor, which is the
 * failure most likely to make this unbearable in practice."* Turning this on for
 * every session in this repository is the adoption that question gates, and it
 * needs a batch of real edits observed end to end — not a timing. So the command
 * exists, is tested, and is switched on by whoever decides to run the experiment.
 *
 * **Exit code is always 0, whatever it finds.** The node's shape is advisory text
 * handed back with the edit result, not a refusal: a run mid-refactor is
 * legitimately broken between two edits. `npx tsc --noEmit` remains the gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatVerdict, TouchedFileChecker } from "../src/runner/incremental-typecheck.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The file path a `PostToolUse` payload names, when stdin carries one. */
function pathFromHookPayload(): string | null {
  if (process.stdin.isTTY) return null;
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  try {
    const payload = JSON.parse(raw) as { tool_input?: { file_path?: unknown } };
    const file = payload.tool_input?.file_path;
    return typeof file === "string" && file.length > 0 ? file : null;
  } catch {
    // Not a hook payload. Silence is right here: the caller asked for a check of
    // the paths on argv, and a parse complaint about stdin would be noise in the
    // middle of somebody's edit.
    return null;
  }
}

/**
 * Nothing here calls `process.exit`, and that is not a style preference.
 *
 * On macOS a pipe's stdout is asynchronous, so a `write` followed immediately by
 * an `exit` can drop the very advisory this command exists to deliver — and a
 * hook's stdout is always a pipe. Falling off the end of `main` lets the stream
 * flush, and leaves the exit code at 0, which is the code this command always
 * wants.
 */
function main(): void {
  const args = process.argv.slice(2);
  const always = args.includes("--always");
  const files = args.filter((a) => !a.startsWith("-"));
  const fromHook = pathFromHookPayload();
  if (fromHook) files.push(fromHook);

  if (files.length === 0) {
    process.stderr.write("usage: tsx scripts/typecheck-touched.ts [--always] <file>…\n");
    return;
  }

  // Only files this project's `tsconfig.json` actually compiles. A hook fires on
  // every write, and most writes are Markdown; checking them would report a
  // program that cannot read its subject rather than nothing to say.
  const checker = new TouchedFileChecker({ projectRoot: repoRoot });
  const inProject = new Set(checker.files.map((f) => path.resolve(f)));
  const targets = files.map((f) => path.resolve(repoRoot, f)).filter((f) => inProject.has(f));

  if (targets.length === 0) {
    if (always) {
      process.stdout.write("typecheck (advisory): nothing to check — no named file is in the TypeScript project\n");
    }
    return;
  }

  const verdict = checker.check(targets.map((p) => ({ path: p })));
  const report = formatVerdict(verdict);
  if (report) process.stdout.write(`${report}\n`);
  else if (always) {
    process.stdout.write(
      `typecheck (advisory): clean — ${verdict.checked.join(", ")} and ${verdict.dependents.length} immediate ` +
        `dependent(s), in ${Math.round(verdict.elapsedMs)} ms\n`,
    );
  }
}

main();
process.exit(0);
