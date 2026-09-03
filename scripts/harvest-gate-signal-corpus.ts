/**
 * Cut the gate-signal-density corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed under `test/fixtures/gate-signal-density/`. It
 * exists so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-gate-signal-corpus.ts ~/.claude/projects \
 *     test/fixtures/gate-signal-density 89ac8277-29ce-4d80-827e-cefea0bebabf
 *
 * Two artefacts come out:
 *
 * - **`<session>.jsonl`** — the session reduced to what a reader saw. Every
 *   assistant text block, every tool call, every tool result, in order, with
 *   **no truncation anywhere**. Truncating a result would change the line counts,
 *   and the line counts are the measurement — so the fields dropped are only the
 *   ones no reader reads: uuids, parent links, token usage, timestamps, and the
 *   `toolUseResult` mirror of content already carried in the message.
 * - **`corpus.json`** — the stream length, and for each of the three firings its
 *   position, both attribution rules' counts at the primary radius, the flip
 *   radius, and the distance to the next line of prose. This is what the cut
 *   claims; the test recomputes all of it from the transcript rather than
 *   trusting it, so a stale summary fails rather than passes.
 *
 * Nothing here is imported by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import {
  GATE_FIRINGS_2026_08_06,
  SCREEN_RADIUS,
  measureFiring,
  readerLines,
} from "../src/telemetry/gate-signal-density.js";

/** Every `*.jsonl` under the projects root, walked recursively. */
function transcriptFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable directory is fewer transcripts, never a failed harvest
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Drop everything a reader never read, keep every character they did.
 *
 * Thinking blocks go, because `readerLines` does not count them and carrying
 * them would let a later change quietly start counting them.
 */
function reduce(jsonl: string): string {
  const kept: unknown[] = [];
  for (const raw of jsonl.split("\n")) {
    if (raw.trim() === "") continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (record.type === "assistant" && Array.isArray(content)) {
      const blocks = (content as Record<string, unknown>[])
        .filter((b) => b.type === "text" || b.type === "tool_use")
        .map((b) =>
          b.type === "text"
            ? { type: "text", text: b.text }
            : { type: "tool_use", name: b.name, input: b.input },
        );
      if (blocks.length) kept.push({ type: "assistant", message: { content: blocks } });
    } else if (record.type === "user") {
      if (typeof content === "string") {
        kept.push({ type: "user", message: { content } });
      } else if (Array.isArray(content)) {
        const blocks = (content as Record<string, unknown>[])
          .filter((b) => b.type === "text" || b.type === "tool_result")
          .map((b) => {
            if (b.type === "text") return { type: "text", text: b.text };
            const c = b.content;
            const text =
              typeof c === "string"
                ? c
                : Array.isArray(c)
                  ? (c as { text?: string }[]).map((x) => x.text ?? "").join("\n")
                  : "";
            return { type: "tool_result", content: text };
          });
        if (blocks.length) kept.push({ type: "user", message: { content: blocks } });
      }
    }
  }
  return kept.map((k) => JSON.stringify(k)).join("\n") + "\n";
}

function main(): void {
  const [projectsRoot, outDir, sessionId] = process.argv.slice(2);
  if (!projectsRoot || !outDir || !sessionId) {
    console.error(
      "usage: harvest-gate-signal-corpus.ts <projectsRoot> <outDir> <sessionId>",
    );
    process.exit(2);
  }
  const files = transcriptFiles(path.resolve(projectsRoot.replace(/^~/, process.env.HOME ?? "~")));
  const match = files.find((f) => path.basename(f) === `${sessionId}.jsonl`);
  if (!match) {
    console.error(`no transcript named ${sessionId}.jsonl under ${projectsRoot} (${files.length} read)`);
    process.exit(1);
  }
  const original = fs.readFileSync(match, "utf8");
  const reduced = redactSecrets(reduce(original));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${sessionId}.jsonl`), reduced);

  const lines = readerLines(reduced);
  const fromOriginal = readerLines(original);
  const summary = {
    sessionId,
    transcriptsRead: files.length,
    /** The reduction must not move a single line, or the census is over a different session. */
    readerLines: lines.length,
    readerLinesInOriginal: fromOriginal.length,
    screenRadius: SCREEN_RADIUS,
    firings: GATE_FIRINGS_2026_08_06.map((spec) => {
      const strict = measureFiring(lines, spec, { mode: "strict" });
      const generous = measureFiring(lines, spec, { mode: "generous" });
      return {
        key: spec.key,
        gate: spec.gate,
        firstReading: spec.firstReading,
        actually: spec.actually,
        index: strict.index,
        linesToNextProse: strict.linesToNextProse,
        strict: {
          unrelated: strict.unrelated,
          unrelatedBefore: strict.unrelatedBefore,
          unrelatedAfter: strict.unrelatedAfter,
          flipRadius: strict.flipRadius,
        },
        generous: {
          unrelated: generous.unrelated,
          unrelatedBefore: generous.unrelatedBefore,
          unrelatedAfter: generous.unrelatedAfter,
          flipRadius: generous.flipRadius,
        },
      };
    }),
  };
  fs.writeFileSync(path.join(outDir, "corpus.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main();
