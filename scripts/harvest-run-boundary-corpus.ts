/**
 * Cut the run-boundary corpus: real vault commits, plus the true extent of the
 * runs that made them, taken from somewhere other than git.
 *
 * Run by hand, output committed under `test/fixtures/run-boundary/`. It exists
 * so the cut is a rule anyone can re-run and disagree with rather than a
 * selection somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-run-boundary-corpus.ts \
 *     /Users/tanner/ost-agent-meta ~/.claude/projects/-Users-tanner-ost-agent-meta \
 *     test/fixtures/run-boundary --until 2026-08-31T13:00:00Z --limit 600
 *
 * **The point of the second argument.** `src/loop/run-boundary.ts` reads commit
 * subjects and times. If the labels were cut the same way, agreement would be
 * 100% and would measure nothing. So the labels come from the Claude Code
 * session transcripts that drove the runs — a record git has never seen — and
 * the two windows are deliberately unequal:
 *
 * - **Discovery passes** are labelled at *call level*. A transcript records
 *   `mcp__ost-agent__ost_append_to_node` at 10:02:39; the vault carries a commit
 *   whose subject names `ost_append_to_node` at 10:02:39. The commit belongs to
 *   that session. This is the strong label: it never uses the gap between
 *   commits, the author, or the run's shape, which is everything the rule uses.
 * - **Build firings** are labelled by *window*. The build loop's instrument
 *   sweeps are run by the shell around the builder session rather than by the
 *   session, so there is no tool call to match; the label is "every
 *   `ost-build-loop` commit inside this session's transcript window, padded by
 *   the time a sweep takes at each end". Weaker, and deliberately free of the
 *   subject forms the rule keys on, so the rule cannot be scoring its own
 *   assumption back.
 *
 * A session that wrote through the MCP surface is a discovery pass; one that
 * wrote nothing through it is a builder session. That split is read from the
 * transcript, not from the commits.
 *
 * Nothing here is imported by `src/` or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { toolFromSubject } from "../src/loop/pass-shape.js";
import type { HistoryCommit } from "../src/loop/run-boundary.js";

/**
 * MCP calls that write, so a commit exists to match them against. Read calls
 * are ignored: they leave no commit and would only add noise to the match.
 */
const WRITE_CALLS = new Set([
  "ost_ingest_inbox",
  "ost_create_node",
  "ost_append_to_node",
  "ost_annotate",
  "ost_edit_node",
  "ost_set_status",
  "ost_set_evidence",
  "ost_set_instrument",
  "ost_link_nodes",
  "ost_unlink_nodes",
  "ost_merge_nodes",
  "ost_detach_nodes",
  "ost_set_outcome",
]);

/**
 * How far apart a commit and the tool call that made it may be and still be the
 * same event. Generous — the commit is written inside the call, so the real
 * distance is under two seconds — and it is only ever used to pick the *nearest*
 * candidate, so widening it cannot create a match that a tighter window would
 * have got right.
 */
const CALL_MATCH_SECONDS = 180;

/** Pre-sweep runs before the builder session opens; post-sweep after it exits. */
const SWEEP_LEAD_SECONDS = 600;
const SWEEP_TRAIL_SECONDS = 1200;

/** `%x1f` in the log format below — a byte no commit subject contains. */
const UNIT_SEPARATOR = "\u001f";

/** Subjects are kept to this many characters — `ost_ingest_inbox` runs to a kilobyte. */
const SUBJECT_CHARS = 240;

interface SessionFacts {
  sessionId: string;
  /** Epoch seconds of the first and last event in the transcript. */
  startedAt: number;
  endedAt: number;
  /** Every MCP write call the session made, as (epoch seconds, tool). */
  writes: { at: number; tool: string }[];
}

interface TruthRun {
  runId: string;
  kind: "discovery" | "build-loop";
  /** How this run's extent was established, in one phrase. */
  label: "tool-call-match" | "session-window";
  shas: string[];
}

function seconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** `git log`, oldest first, in the shape the reader under test consumes. */
function readCommits(vault: string, until: string, limit: number): HistoryCommit[] {
  const raw = execFileSync(
    "git",
    ["-C", vault, "log", "--reverse", `--before=${until}`, `-${limit}`, "--format=%H%x1f%at%x1f%ct%x1f%an%x1f%ae%x1f%s"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const out: HistoryCommit[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const [sha, at, ct, authorName, authorEmail, ...rest] = line.split(UNIT_SEPARATOR);
    out.push({
      sha,
      authoredAt: Number(at),
      committedAt: Number(ct),
      authorName,
      authorEmail,
      subject: rest.join(UNIT_SEPARATOR).slice(0, SUBJECT_CHARS),
    });
  }
  return out;
}

/** One session's timestamps and MCP write calls, or null when it recorded neither. */
function readSession(file: string): SessionFacts | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // an unreadable transcript is one fewer label, never a failed harvest
  }
  const stamps: number[] = [];
  const writes: { at: number; tool: string }[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stamp = typeof entry.timestamp === "string" ? seconds(entry.timestamp) : undefined;
    if (stamp !== undefined && Number.isFinite(stamp)) stamps.push(stamp);
    if (entry.type !== "assistant" || stamp === undefined) continue;
    const message = entry.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      const b = block as { type?: string; name?: string };
      if (b?.type !== "tool_use" || typeof b.name !== "string") continue;
      if (!b.name.startsWith("mcp__ost-agent__")) continue;
      const tool = b.name.slice("mcp__ost-agent__".length);
      if (WRITE_CALLS.has(tool)) writes.push({ at: stamp, tool });
    }
  }
  if (stamps.length === 0) return null;
  return {
    sessionId: path.basename(file, ".jsonl"),
    startedAt: Math.min(...stamps),
    endedAt: Math.max(...stamps),
    writes,
  };
}

function main(): void {
  const [vault, projectDir, outDir] = process.argv.slice(2);
  const until = argValue("--until") ?? new Date().toISOString();
  const limit = Number(argValue("--limit") ?? 600);
  if (!vault || !projectDir || !outDir) {
    console.error("usage: harvest-run-boundary-corpus.ts <vault> <claude-project-dir> <out-dir> [--until ISO] [--limit N]");
    process.exit(2);
  }

  const commits = readCommits(vault, until, limit);
  if (commits.length === 0) throw new Error(`no commits before ${until} in ${vault}`);
  const first = commits[0].authoredAt;
  const last = commits[commits.length - 1].authoredAt;

  const files = fs
    .readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(projectDir, f));
  const sessions: SessionFacts[] = [];
  for (const file of files) {
    const session = readSession(file);
    if (!session) continue;
    // Anything that cannot overlap the commit window is not a label for it.
    if (session.endedAt < first - 3 * 3600 || session.startedAt > last + 3 * 3600) continue;
    sessions.push(session);
  }

  // --- Discovery passes: one commit to one tool call, by tool name and time.
  const discovery = new Map<string, string[]>();
  let unmatched = 0;
  let ambiguous = 0;
  for (const commit of commits) {
    const tool = toolFromSubject(commit.subject);
    if (tool === undefined) continue;
    const near = sessions.flatMap((s) =>
      s.writes
        .filter((w) => w.tool === tool && Math.abs(w.at - commit.authoredAt) <= CALL_MATCH_SECONDS)
        .map((w) => ({ distance: Math.abs(w.at - commit.authoredAt), sessionId: s.sessionId })),
    );
    if (near.length === 0) {
      unmatched++;
      continue;
    }
    near.sort((a, b) => a.distance - b.distance);
    if (new Set(near.map((n) => n.sessionId)).size > 1 && near[0].distance === near[1].distance) {
      ambiguous++;
      continue;
    }
    const bucket = discovery.get(near[0].sessionId) ?? [];
    bucket.push(commit.sha);
    discovery.set(near[0].sessionId, bucket);
  }

  // --- Build firings: every build-loop commit inside the builder session's window.
  const buildLoopCommits = commits.filter((c) => c.subject.startsWith("chore(instruments):"));
  const build = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.writes.length > 0) continue; // wrote through MCP → a discovery pass
    const inside = buildLoopCommits.filter(
      (c) => c.authoredAt >= session.startedAt - SWEEP_LEAD_SECONDS && c.authoredAt <= session.endedAt + SWEEP_TRAIL_SECONDS,
    );
    // One commit is a firing whose other sweep fell outside the window — an
    // extent that is not established, so it is not a label.
    if (inside.length >= 2) build.set(session.sessionId, inside.map((c) => c.sha));
  }

  /**
   * Two builder sessions can be open at once, and a padded window is not sharp
   * enough to say which of them a sweep belongs to. A commit claimed by two
   * windows means neither firing's extent is established, so both come out —
   * dropping only one would be choosing an answer the record does not give.
   * Four commits and three sessions on the cut this was written against.
   */
  const claims = new Map<string, string[]>();
  for (const [sessionId, shas] of build) for (const sha of shas) claims.set(sha, [...(claims.get(sha) ?? []), sessionId]);
  const contested = new Set([...claims.values()].filter((v) => v.length > 1).flat());
  for (const sessionId of contested) build.delete(sessionId);
  const droppedContested = contested.size;

  /**
   * A run the commit window cut in half is not a run this can be scored on: its
   * true extent runs off the end of the corpus, so both the label and the
   * reconstruction are clipped by the same edge and agreeing about it says
   * nothing. Judged from the session window — the independent record — rather
   * than from where its commits happen to land.
   */
  const clipped = (sessionId: string): boolean => {
    const session = sessions.find((s) => s.sessionId === sessionId);
    return session === undefined || session.startedAt <= first || session.endedAt >= last;
  };
  let droppedClipped = 0;
  for (const sessionId of [...discovery.keys()]) if (clipped(sessionId)) (discovery.delete(sessionId), droppedClipped++);
  for (const sessionId of [...build.keys()]) if (clipped(sessionId)) (build.delete(sessionId), droppedClipped++);

  const order = new Map(commits.map((c, i) => [c.sha, i]));
  const runs: TruthRun[] = [
    ...[...discovery].map(([sessionId, shas]): TruthRun => ({
      runId: `discovery:${sessionId}`,
      kind: "discovery",
      label: "tool-call-match",
      shas: shas.sort((a, b) => order.get(a)! - order.get(b)!),
    })),
    ...[...build].map(([sessionId, shas]): TruthRun => ({
      runId: `build-loop:${sessionId}`,
      kind: "build-loop",
      label: "session-window",
      shas: shas.sort((a, b) => order.get(a)! - order.get(b)!),
    })),
  ].sort((a, b) => order.get(a.shas[0])! - order.get(b.shas[0])!);

  const corpus = {
    vault: path.resolve(vault),
    head: execFileSync("git", ["-C", vault, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    until,
    firstCommit: commits[0].sha,
    lastCommit: commits[commits.length - 1].sha,
    transcriptsRead: files.length,
    sessionsInWindow: sessions.length,
    /** `mcp:` commits no tool call in any transcript accounts for. */
    unmatchedToolCommits: unmatched,
    ambiguousToolCommits: ambiguous,
    /**
     * Labels the record could not establish, said out loud rather than
     * silently subtracted: a coverage bound this cut chose is a number a reader
     * has to be able to see before they read the score below it.
     */
    droppedContestedLabels: droppedContested,
    droppedClippedLabels: droppedClipped,
    commits,
    runs,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "corpus.json"), `${JSON.stringify(corpus, null, 1)}\n`);
  console.log(
    `${commits.length} commits, ${runs.length} labelled runs ` +
      `(${runs.filter((r) => r.kind === "discovery").length} discovery, ${runs.filter((r) => r.kind === "build-loop").length} build-loop), ` +
      `${unmatched} unmatched, ${ambiguous} ambiguous, ` +
      `${droppedContested} contested and ${droppedClipped} clipped label(s) dropped → ${path.join(outDir, "corpus.json")}`,
  );
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

main();
