/**
 * Cut the path-failure-attribution corpus out of this machine's Claude Code transcripts.
 *
 * Run by hand, output committed to `test/fixtures/path-failure-attribution/`. It
 * exists so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md` for what the rule
 * is and what it deliberately leaves out.
 *
 *   npx tsx scripts/harvest-path-failure-corpus.ts ~/.claude/projects test/fixtures/path-failure-attribution
 *
 * Every failing call is kept, not only the path-shaped ones. The census's negative
 * direction — the 643 failures it must NOT count — is the half that a classifier
 * tuned to answer "path failure" to everything would sail through, so the corpus
 * has to carry it.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import {
  classifyPathFailure,
  clip,
  MAX_COMMAND_CHARS,
  MAX_ERROR_CHARS,
  readPathFailures,
  type FailingCall,
} from "../src/telemetry/path-failure-attribution.js";
import type { TranscriptSession } from "../src/telemetry/preflight.js";

const [, , rootArg, outArg, ...rest] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-path-failure-corpus.ts <projects-dir> <out-dir> [--exclude <session-id>]…");
  process.exit(2);
}
const root = path.resolve(rootArg);
const out = path.resolve(outArg);

/**
 * Sessions left out by id. A count must not include the failures its own
 * construction caused: the session that cut this corpus spends its whole life
 * addressing paths in two repositories at once, which is the exact behaviour the
 * census is measuring, and every failure it makes is a foreign one.
 */
const excludedSessions: string[] = [];
/**
 * Sessions cut down to their path-shaped failures and committed as raw `.jsonl`,
 * so the reader is exercised against the shape of the real record rather than only
 * against synthetic entries. Only the entry holding the `tool_use` and the entry
 * holding its `tool_result` are kept, in original order.
 */
const slicedSessions: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--exclude" && rest[i + 1]) excludedSessions.push(rest[++i]);
  else if (rest[i] === "--slice" && rest[i + 1]) slicedSessions.push(rest[++i]);
}

/** Every `.jsonl` under the projects root, at any depth — worktrees nest. */
function transcripts(dir: string): string[] {
  const found: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) found.push(...transcripts(full));
    else if (name.endsWith(".jsonl")) found.push(full);
  }
  return found.sort();
}

const files = transcripts(root);
const sessions: TranscriptSession[] = [];
for (const file of files) {
  const id = path.basename(file, ".jsonl");
  if (excludedSessions.includes(id)) continue;
  try {
    sessions.push({ id, jsonl: fs.readFileSync(file, "utf8") });
  } catch {
    // an unreadable transcript is one fewer session, and the count below says so
  }
}

const { failures, calls, errors } = readPathFailures(sessions);

/**
 * The bound check, run here rather than asserted in the test, because only this
 * script has the unbounded text. If clipping ever changes what the classifier
 * sees, the cut is wrong and the number would be an artefact of the fixture.
 */
const unbounded = readPathFailuresUnbounded(sessions);
const boundedShaped = failures.filter((f) => classifyPathFailure(f.error) !== null).length;
const unboundedShaped = unbounded.filter((f) => classifyPathFailure(f.error) !== null).length;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "failures.jsonl"),
  failures.map((f) => JSON.stringify(redactCall(f))).join("\n") + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(out, "corpus.json"),
  JSON.stringify(
    {
      projectsRoot: root,
      transcriptsFound: files.length,
      excludedSessions,
      transcriptsRead: sessions.length,
      calls,
      errors,
      maxErrorChars: MAX_ERROR_CHARS,
      maxCommandChars: MAX_COMMAND_CHARS,
      pathShapedBounded: boundedShaped,
      pathShapedUnbounded: unboundedShaped,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

for (const id of slicedSessions) {
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    console.error(`--slice ${id}: no such session under ${root}`);
    continue;
  }
  const kept = sliceToPathFailures(session);
  fs.writeFileSync(path.join(out, `${id}.jsonl`), kept.join("\n") + "\n", "utf8");
  console.log(`sliced ${id}: ${kept.length} entries`);
}

console.log(
  `${sessions.length} transcripts, ${calls} calls, ${errors} failures, ` +
    `${boundedShaped} path-shaped (unbounded: ${unboundedShaped})`,
);

/**
 * The entries of one session that carry a path-shaped failure and the call that
 * caused it, verbatim apart from `redactSecrets`, in original order.
 */
function sliceToPathFailures(session: TranscriptSession): string[] {
  const lines = session.jsonl.split("\n");
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line.trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
  const blocksOf = (entry: Record<string, unknown> | null): Record<string, unknown>[] => {
    const message = entry?.message as Record<string, unknown> | undefined;
    return Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];
  };

  const wanted = new Set<number>();
  const callLine = new Map<string, number>();
  for (let i = 0; i < parsed.length; i++) {
    for (const block of blocksOf(parsed[i])) {
      if (block.type === "tool_use" && typeof block.id === "string") callLine.set(block.id, i);
      if (block.type === "tool_result" && block.is_error === true) {
        const body = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as unknown[])
                .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
                .join(" ")
            : "";
        if (!classifyPathFailure(body)) continue;
        wanted.add(i);
        const at = callLine.get(String(block.tool_use_id ?? ""));
        if (at !== undefined) wanted.add(at);
      }
    }
  }
  return [...wanted].sort((a, b) => a - b).map((i) => redactSecrets(lines[i].trim()));
}

function redactCall(call: FailingCall): FailingCall {
  return {
    session: call.session,
    tool: call.tool,
    command: redactSecrets(call.command),
    error: redactSecrets(call.error),
  };
}

/** The same lift with the clipping undone, for the bound check only. */
function readPathFailuresUnbounded(all: TranscriptSession[]): FailingCall[] {
  const huge = 1_000_000;
  const lifted: FailingCall[] = [];
  for (const session of all) {
    const byId = new Map<string, { name: string; command: string }>();
    for (const raw of session.jsonl.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const message = entry.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          byId.set(block.id, {
            name: String(block.name ?? ""),
            command: typeof input.command === "string" ? input.command : "",
          });
        }
        if (block.type === "tool_result" && block.is_error === true) {
          const call = byId.get(String(block.tool_use_id ?? ""));
          const body = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? (block.content as unknown[])
                  .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
                  .join(" ")
              : "";
          lifted.push({
            session: session.id,
            tool: call?.name ?? "",
            command: clip(call?.command ?? "", huge),
            error: clip(body, huge),
          });
        }
      }
    }
  }
  return lifted;
}
