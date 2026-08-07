/**
 * Cut the drift-window corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed under `test/fixtures/drift-window/`. It exists so
 * the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-drift-corpus.ts ~/.claude/projects test/fixtures/drift-window
 *
 * Two artefacts come out, because they answer two different questions:
 *
 * - **`<session>.jsonl`** — one reduced transcript per session that actually
 *   recorded a collision. Reduced, not summarised: every tool call keeps its
 *   position, so the step distance the census measures is the real one, and every
 *   result keeps exactly the first `resultHeadChars` characters that
 *   `replaySession` reads. Nothing the reader looks at is dropped, so the census
 *   over these files is the census over the originals.
 * - **`corpus.json`** — how many transcripts were read, and one summary line per
 *   session whose *text* contains the failure phrase. That set is five times
 *   larger than the set of sessions the failure happened in, and the summary
 *   carries which tool delivered each match so the overcount can be counted
 *   instead of asserted.
 *
 * Bodies are not committed for the mention-only sessions: a `Bash` grep for the
 * phrase prints thousands of lines of unrelated output, and the only thing the
 * census needs from those sessions is that the match arrived from a tool that
 * does not write files.
 *
 * Nothing here is imported by src/ or by a test. The fixtures are the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { COLLISION_PHRASE, DRIFT_WINDOW_RULE } from "../src/runner/drift-window.js";

const EDIT_TOOLS = new Set<string>(DRIFT_WINDOW_RULE.editTools);

interface SessionSummary {
  sessionId: string;
  origin: string;
  stepCount: number;
  /** Whether an edit tool returned the phrase as an error — the only real collision. */
  collision: boolean;
  /** Which tool delivered each loose text match, in step order. */
  mentions: { step: number; tool: string }[];
}

/** Every `*.jsonl` under the projects root, including subagent transcripts. */
function transcriptFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
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
 * What kind of session this is, in one phrase. A subagent transcript is a
 * different thing from the session that spawned it — it has its own steps and,
 * as the corpus shows, its own blind spots — so the two are labelled apart.
 */
function originOf(root: string, file: string): string {
  const rel = path.relative(root, file);
  const parts = rel.split(path.sep);
  const project = parts[0] ?? "?";
  return parts.length > 1 && parts.includes("subagents")
    ? `subagent under ${parts[1]}, in ${project}`
    : `session in ${project}`;
}

function harvest(root: string, outDir: string, exclude: string[]) {
  const files = transcriptFiles(root);
  const excluded = new Set(exclude);
  const summaries: SessionSummary[] = [];
  const seen = new Set<string>();
  let written = 0;
  let duplicates = 0;

  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue; // an unreadable transcript is one fewer session
    }
    if (!COLLISION_PHRASE.test(raw)) continue;

    // A subagent transcript is filed under every parent session that ran it, so the
    // same run appears two or three times on disk. Counting those copies would
    // inflate both the denominator and — worse — the number of collisions.
    const sessionId = path.basename(file, ".jsonl");
    if (seen.has(sessionId)) {
      duplicates++;
      continue;
    }
    seen.add(sessionId);
    // A census must not count the searches its own construction caused: the session
    // that cut this corpus grepped every transcript for the phrase, which puts the
    // phrase in its own transcript.
    if (excluded.has(sessionId)) continue;
    const reduced: string[] = [];
    const mentions: { step: number; tool: string }[] = [];
    const byToolUseId = new Map<string, { step: number; tool: string }>();
    let steps = 0;
    let collision = false;

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: Record<string, any>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "attachment" && entry.attachment?.type === "edited_text_file") {
        // Only the filename is kept; the attachment also carries a snippet of the
        // file, which is neither read by the census nor ours to commit.
        reduced.push(
          JSON.stringify({ type: "attachment", attachment: { type: "edited_text_file", filename: entry.attachment.filename } }),
        );
        continue;
      }

      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block?.type === "tool_use" && entry.type === "assistant") {
          byToolUseId.set(block.id, { step: steps, tool: block.name });
          steps++;
          reduced.push(
            JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  { type: "tool_use", id: block.id, name: block.name, ...(block.input?.file_path ? { input: { file_path: block.input.file_path } } : {}) },
                ],
              },
            }),
          );
          continue;
        }
        if (block?.type !== "tool_result") continue;
        const call = byToolUseId.get(block.tool_use_id);
        if (!call) continue;
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        const mentionsPhrase = COLLISION_PHRASE.test(text);
        if (mentionsPhrase) mentions.push(call);
        if (mentionsPhrase && block.is_error && EDIT_TOOLS.has(call.tool)) collision = true;
        reduced.push(
          JSON.stringify({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: block.tool_use_id,
                  is_error: Boolean(block.is_error),
                  content: redactSecrets(text.slice(0, DRIFT_WINDOW_RULE.resultHeadChars)),
                  // Computed on the full result, so a reduced transcript can still
                  // report a match found in output too large to commit.
                  mentionsPhrase,
                },
              ],
            },
          }),
        );
      }
    }

    const origin = originOf(root, file);
    summaries.push({ sessionId, origin, stepCount: steps, collision, mentions });

    if (!collision) continue;
    fs.writeFileSync(path.join(outDir, `${sessionId}.jsonl`), reduced.join("\n") + "\n");
    written++;
  }

  summaries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  fs.writeFileSync(
    path.join(outDir, "corpus.json"),
    JSON.stringify(
      {
        transcriptsRead: files.length,
        duplicateTranscripts: duplicates,
        excludedSessions: exclude,
        projectsRoot: root,
        sessions: summaries,
      },
      null,
      2,
    ) + "\n",
  );
  console.error(
    `read ${files.length} transcripts (${duplicates} duplicate copies skipped); ${summaries.length} mention the failure, ` +
      `${summaries.filter((s) => s.collision).length} recorded one, ${written} reduced transcripts written`,
  );
}

const root = process.argv[2];
const outDir = process.argv[3];
const exclude = process.argv.slice(4);
if (!root || !outDir) {
  console.error("usage: npx tsx scripts/harvest-drift-corpus.ts <~/.claude/projects> <out dir> [session id to exclude…]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
harvest(root, outDir, exclude);
