/**
 * Cut the scaffold-init corpus for `test/runner/unconditional-scaffold-init.test.ts`.
 *
 *   npx tsx scripts/harvest-scaffold-init-corpus.ts ~/.claude/projects test/fixtures/scaffold-init
 *
 * Two halves, and they are cut from different places on purpose:
 *
 *   - **The failures** come from the committed `test/fixtures/path-failure-attribution/failures.jsonl`,
 *     the same upstream the workspace-state census reads. Starting there means this census
 *     and that one cannot disagree about what failed, and it is why the failure half of
 *     this corpus is reproducible on any checkout without a machine.
 *   - **The creation evidence, the scaffold targets and the repository roots** cannot come
 *     from that file, because it holds only *failing* calls and every one of these facts is
 *     established by a call that **succeeded**. They are read from the transcripts. That is
 *     machine state, it decays, and the corpus records the decay rather than hiding it: two
 *     of the sessions this census counts no longer exist on disk, and their rows say so.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import {
  classifyUninitialisedRepoFailure,
  shellSegments,
  workingDirectoryAt,
  type CreationEvidence,
  type WorkingTreeDir,
  type ScaffoldTarget,
  type UninitialisedRepoFailure,
} from "../src/runner/scaffold-init.js";
import type { FailingCall } from "../src/telemetry/path-failure-attribution.js";

const [, , rootArg, outArg] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-scaffold-init-corpus.ts <projects-dir> <out-dir>");
  process.exit(2);
}
const projects = path.resolve(rootArg.replace(/^~/, process.env.HOME ?? "~"));
const out = path.resolve(outArg);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ── half one: the failures, off the committed upstream ───────────────────────

const upstreamFile = path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl");
const upstream = fs
  .readFileSync(upstreamFile, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as FailingCall);

const failures: UninitialisedRepoFailure[] = upstream
  .map(classifyUninitialisedRepoFailure)
  .filter((f): f is UninitialisedRepoFailure => f !== null);

const failureDirs = [...new Set(failures.map((f) => f.dir).filter((d): d is string => d !== null))].sort();

// ── half two: the transcripts ────────────────────────────────────────────────

interface ToolCall {
  session: string;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
}

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

const files = transcripts(projects);
const sessionsOnDisk = new Set(files.map((f) => path.basename(f, ".jsonl")));

function* calls(): Generator<ToolCall> {
  for (const file of files) {
    const session = path.basename(file, ".jsonl");
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const pending = new Map<string, { tool: string; input: Record<string, unknown> }>();
    const emitted = new Set<string>();
    const rows: ToolCall[] = [];
    for (const line of text.split("\n")) {
      let entry: { message?: { content?: unknown[] } };
      try {
        entry = JSON.parse(line) as { message?: { content?: unknown[] } };
      } catch {
        continue;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const raw of content) {
        const block = raw as { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean };
        if (block.type === "tool_use" && block.id && block.name) {
          pending.set(block.id, { tool: block.name, input: block.input ?? {} });
        }
        if (block.type === "tool_result" && block.tool_use_id) {
          const use = pending.get(block.tool_use_id);
          if (!use) continue;
          pending.delete(block.tool_use_id);
          emitted.add(block.tool_use_id);
          rows.push({ session, tool: use.tool, input: use.input, ok: block.is_error !== true });
        }
      }
    }
    // An unpaired call is an unknown outcome, not a success. Kept, marked failed, so a
    // repository root is never established by a git command nobody saw the answer to.
    for (const [id, use] of pending) if (!emitted.has(id)) rows.push({ session, tool: use.tool, input: use.input, ok: false });
    yield* rows;
  }
}

const CLIP = 200;
const clip = (s: string): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > CLIP ? `${flat.slice(0, CLIP)}…` : flat;
};

const INIT_CALL = /(?:ost-agent(?:\.mjs)?|cli\/index\.js)\s+init(?:\s|$)/;

/**
 * Prose that quotes the command rather than running it.
 *
 * PR bodies and commit messages in this record write ``run `ost-agent init` first``,
 * and a segment splitter cannot tell that from a run. A backtick is the marker: every
 * real invocation in this record uses `$(…)` for substitution, never backticks, so a
 * backticked segment is quotation. Counted, not silently dropped — see `prose` in
 * `corpus.json`.
 */
const QUOTED = /`/;

/** `ost-agent init` in any of the forms the record uses, with the index of its segment. */
function initInvocations(command: string): { segment: string; index: number; quoted: boolean }[] {
  return shellSegments(command)
    .map((segment, index) => ({ segment, index, quoted: QUOTED.test(segment) }))
    .filter((s) => INIT_CALL.test(s.segment));
}

/**
 * The directory an `init` segment points at: `--vault X`, or the first positional
 * argument, resolved against the command's leading `cd`. Unresolved when the target is
 * a shell variable or a substitution — those cannot be turned into a path after the
 * fact, and guessing would let the safety clause pass on rows nobody checked.
 */
function initTarget(segment: string, cwd: string | null): { dir: string | null; unresolved?: string } {
  const vault = /(?:--vault|-v)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(segment);
  let raw = vault?.[1] ?? vault?.[2] ?? vault?.[3];
  if (!raw) {
    const after = segment.split(/(?:ost-agent(?:\.mjs)?|cli\/index\.js)\s+init\s*/)[1] ?? "";
    const first = /^(?:"([^"]+)"|'([^']+)'|([^-\s][^\s]*))/.exec(after.trim());
    raw = first?.[1] ?? first?.[2] ?? first?.[3];
  }
  if (!raw) return { dir: null, unresolved: "no target argument — `init --help` or a flags-only invocation" };
  if (/[$`]/.test(raw)) return { dir: null, unresolved: `target is a shell variable or substitution: ${raw}` };
  if (raw.startsWith("<") || raw.startsWith("[")) return { dir: null, unresolved: `target is documentation placeholder text: ${raw}` };
  if (raw.startsWith("/")) return { dir: path.resolve(raw) };
  if (!cwd) return { dir: null, unresolved: `relative target ${raw} and the command does not say where it ran` };
  return { dir: path.resolve(cwd, raw) };
}

const targets: ScaffoldTarget[] = [];
const prose: { session: string; command: string }[] = [];
const treeReads = new Map<string, number>();
const worktreesAdded = new Set<string>();
const creators = new Map<string, { session: string; tool: string; command: string }>();
let toolCalls = 0;

/** A git command that only reads. A write could have *made* the repository it ran in. */
const GIT_READ = /^\s*git\s+(?:-c\s+\S+\s+)*(status|log|rev-parse|branch|diff|show|describe|remote)\b/;

for (const call of calls()) {
  toolCalls++;
  const command = typeof call.input.command === "string" ? call.input.command : "";
  const filePath = typeof call.input.file_path === "string" ? call.input.file_path : "";

  if (call.tool === "Bash" && command) {
    const segments = shellSegments(command);
    for (const { segment, index, quoted } of initInvocations(command)) {
      // `init --help` prints usage and scaffolds nothing.
      if (/--help/.test(segment)) continue;
      if (quoted) {
        prose.push({ session: call.session, command: clip(segment) });
        continue;
      }
      const { dir, unresolved } = initTarget(segment, workingDirectoryAt(segments, index));
      targets.push({ dir, command: clip(segment), session: call.session, ...(unresolved ? { unresolved } : {}) });
      if (dir && !creators.has(dir)) creators.set(dir, { session: call.session, tool: "Bash", command: clip(segment) });
    }

    // Where `git worktree add` put a repository. Used only to show that this record
    // creates nested repositories routinely — by another hand than the scaffolder.
    for (const [index, segment] of segments.entries()) {
      const wt = /^git\s+worktree\s+add\s+((?:-\S+\s+)*)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(segment);
      const raw = wt?.[2] ?? wt?.[3] ?? wt?.[4];
      if (!raw || /[$`]/.test(raw)) continue;
      const base = raw.startsWith("/") ? raw : workingDirectoryAt(segments, index);
      if (!base) continue;
      worktreesAdded.add(raw.startsWith("/") ? path.resolve(raw) : path.resolve(base, raw));
    }

    // A directory inside a working tree: a git *read* that succeeded where the command says.
    // Only reads — `git init`, `git worktree add` and `git clone` can *make* the
    // repository, and a root established by one of those would be circular here.
    if (call.ok) {
      for (const [index, segment] of segments.entries()) {
        if (!GIT_READ.test(segment)) continue;
        const cwd = workingDirectoryAt(segments, index);
        if (cwd) treeReads.set(cwd, (treeReads.get(cwd) ?? 0) + 1);
      }
    }
  }

  // Creation evidence for the directories the failures happened in. Only the
  // directories under census — this is not a general index of who made what.
  for (const dir of failureDirs) {
    if (creators.has(dir)) continue;
    if (call.tool === "Write" && filePath.startsWith(`${dir}/`)) {
      creators.set(dir, { session: call.session, tool: "Write", command: clip(filePath) });
    } else if (call.tool === "Bash" && command) {
      const made = new RegExp(`(?:mkdir(?:\\s+-\\S+)*|git\\s+worktree\\s+add(?:\\s+-\\S+)*|git\\s+clone\\s+\\S+|cp\\s+-\\S+\\s+\\S+|tar\\s+-\\S*x\\S*[^|;]*-C)\\s+(?:"?${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?)(?:\\s|$|/)`);
      if (made.test(command)) creators.set(dir, { session: call.session, tool: "Bash", command: clip(command) });
    }
  }
}

const evidence: CreationEvidence[] = failureDirs.map((dir) => {
  const creator = creators.get(dir) ?? null;
  const sessions = failures.filter((f) => f.dir === dir).map((f) => f.session);
  const anyTranscriptGone = sessions.some((s) => !sessionsOnDisk.has(s));
  return {
    dir,
    creator,
    byScaffolder: creator !== null && /(?:ost-agent(?:\.mjs)?|cli\/index\.js)\s+init(?:\s|$)/.test(creator.command),
    ...(creator === null ? { absent: anyTranscriptGone ? ("transcript-gone" as const) : ("no-creating-call-found" as const) } : {}),
  };
});

const trees: WorkingTreeDir[] = [...treeReads.entries()]
  .map(([dir, reads]) => ({ dir, reads }))
  .sort((a, b) => b.reads - a.reads || a.dir.localeCompare(b.dir));

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "failures.json"), `${JSON.stringify(failures, null, 1)}\n`, "utf8");
fs.writeFileSync(
  path.join(out, "corpus.json"),
  `${JSON.stringify(
    {
      projectsRoot: projects,
      upstreamFile: path.relative(repoRoot, upstreamFile),
      upstreamFailures: upstream.length,
      transcriptsRead: files.length,
      toolCalls,
      uninitialisedRepoFailures: failures.length,
      failureDirs,
      sessionsMissingFromDisk: [...new Set(failures.map((f) => f.session))].filter((s) => !sessionsOnDisk.has(s)).sort(),
      prose,
      targets,
      trees,
      worktreesAdded: [...worktreesAdded].sort(),
      evidence,
    },
    null,
    1,
  )}\n`,
  "utf8",
);

console.log(
  `read ${files.length} transcript(s), ${toolCalls} paired tool call(s)\n` +
    `${failures.length} uninitialised-repository failure(s) in ${failureDirs.length} directory(ies)\n` +
    `${targets.length} scaffold target(s), ${trees.length} working-tree directory(ies), ${worktreesAdded.size} worktree(s) added`,
);
