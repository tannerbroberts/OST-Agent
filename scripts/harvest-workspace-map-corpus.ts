/**
 * Cut the workspace-map coverage corpus out of this machine's transcripts.
 *
 * Run by hand, output committed to `test/fixtures/workspace-map/`. It exists so the
 * cut is a rule anyone can re-run and disagree with, rather than a selection somebody
 * made — see that directory's `PROVENANCE.md` for the rule and what it leaves out.
 *
 *   npx tsx scripts/harvest-workspace-map-corpus.ts ~/.claude/projects test/fixtures/workspace-map
 *
 * Two axes decide what survives, and both are published as counts rather than hidden:
 *
 *  - **Is it a path lookup at all?** A failure whose subject is a glob-expanded flag
 *    (`--include=*.ts`) or which names nothing (`File does not exist`, a `git` fatal
 *    outside a repo) is not a path a map could answer, and is dropped.
 *  - **Is it about THIS workspace?** A lookup in a different project, or in an
 *    ephemeral scratch/worktree/plugin directory, is not something a map of this
 *    workspace could ever have answered, and is dropped.
 *
 * What survives is resolved to an absolute path and frozen in `lookups.json`. The
 * ground-truth tree every lookup is scored against — and the tree the map renders
 * from — is frozen in `layout.json`, snapshotted from the live filesystem at cut
 * time so the test runs offline and deterministically. `corpus.json` records the
 * counts and every exclusion, so the number is reconstructible.
 *
 * Nothing here is imported by src/ or by a test. The fixtures are the artefact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyFailure,
  type FailingCall,
} from "../src/telemetry/path-failure-attribution.js";
import {
  defaultWorkspaceSections,
  renderWorkspaceMap,
  workspaceMapCoverage,
  type Layout,
  type WorkspacePathLookup,
} from "../src/runner/workspace-map.js";

const [, , rootArg, outArg] = process.argv;
if (!rootArg || !outArg) {
  console.error("usage: harvest-workspace-map-corpus.ts <projects-dir> <out-dir>");
  process.exit(2);
}
const projectsRoot = path.resolve(rootArg);
const outDir = path.resolve(outArg);
const HOME = os.homedir();

// The path-failure-attribution fixture is the upstream cut: every failing tool call
// found in this machine's transcripts, already redacted and bounded. This harvest
// starts from its path-shaped subset rather than re-reading raw transcripts for the
// failures, so the two corpora cannot disagree about what a path failure is.
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const upstream = fs
  .readFileSync(path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as FailingCall);

// The cwd each failing Bash call ran in is not in the upstream fixture — it lives on
// the raw transcript entry. Read it, keyed by session id and the clipped command, so a
// relative subject can be resolved. Only the transcripts of sessions that actually
// appear in the corpus are read: the projects root holds thousands of unrelated
// subagent transcripts, and walking all of them blocks on I/O for no gain. A session
// whose transcript is not found leaves its relative lookups at `cwd-unknown`, counted.
const neededSessions = new Set(upstream.map((r) => r.session));
const cwdByCall = new Map<string, string>();

/** Every `<session>.jsonl` under the projects root whose id is in `neededSessions`. */
function findNeededTranscripts(dir: string): string[] {
  const found: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findNeededTranscripts(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl") && neededSessions.has(entry.name.replace(/\.jsonl$/, ""))) {
      found.push(full);
    }
  }
  return found;
}

for (const file of findNeededTranscripts(projectsRoot)) {
  const id = path.basename(file).replace(/\.jsonl$/, "");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const cwd = entry.cwd;
    const content = (entry.message as Record<string, unknown> | undefined)?.content;
    if (typeof cwd !== "string" || !Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      const input = block.input as Record<string, unknown> | undefined;
      if (block.type === "tool_use" && typeof input?.command === "string") {
        cwdByCall.set(`${id}::${input.command.slice(0, 80)}`, cwd);
      }
    }
  }
}

// ── the resolution rule ──────────────────────────────────────────────────────

/** Directories that are not this workspace, and whose lookups a workspace map cannot answer. */
const FOREIGN_ROOTS = [
  `${HOME}/dev/tetrix-game-monorepo`,
  `${HOME}/dev/tetrix-ost`,
  `${HOME}/dev/apple-epoch-primes`,
  `${HOME}/dev/ost-benchmarks`,
];
/** Ephemeral areas: a lookup here is about scratch state, not the stable workspace. */
const EPHEMERAL = [/\/\.claude\/worktrees\//, /\/\.claude\/plugins\//, /^\/tmp\//, /^\/private\/tmp\//, /\/scratchpad/];
/** The mapped territory: a workspace lookup must resolve inside one of these. */
const TERRITORY = [
  `${HOME}/dev/OST-Agent`,
  `${HOME}/ost-agent-meta`,
  `${HOME}/ost-agent-vault`,
  `${HOME}/ost-agent-e2e`,
  `${HOME}/dev`,
  HOME,
];

type Exclusion = "not-a-path" | "unnamed" | "cwd-unknown" | "ephemeral" | "foreign-project" | "outside-territory";

/** Resolve a failure's subject to an absolute path, or say why it is not a workspace lookup. */
function resolve(row: FailingCall, subject: string | null): { absolute: string } | { excluded: Exclusion } {
  if (subject === null) return { excluded: "unnamed" };
  let p = subject.replace(/^['"]+|['"]+$/g, "");
  if (p.startsWith("-")) return { excluded: "not-a-path" };
  if (p.startsWith("~")) p = HOME + p.slice(1);
  // Cut the path at its first glob-bearing segment: `/Users/tanner/*/ost08` is a
  // question about `/Users/tanner`, and everything past the star is the guess.
  const segments = p.split("/");
  const globAt = segments.findIndex((s) => /[*?]/.test(s));
  if (globAt >= 0) p = segments.slice(0, globAt).join("/") || "/";

  if (!p.startsWith("/")) {
    const m = /(?:^|;|&&)\s*cd\s+(\S+)/.exec(row.command || "");
    let base: string | undefined = cwdByCall.get(`${row.session}::${(row.command || "").slice(0, 80)}`);
    if (m) {
      let cd = m[1];
      if (cd.startsWith("~")) cd = HOME + cd.slice(1);
      base = cd;
    }
    if (!base) return { excluded: "cwd-unknown" };
    p = path.resolve(base, p);
  }

  if (EPHEMERAL.some((re) => re.test(p))) return { excluded: "ephemeral" };
  if (FOREIGN_ROOTS.some((r) => p === r || p.startsWith(r + "/"))) return { excluded: "foreign-project" };
  if (!TERRITORY.some((t) => p === t || p.startsWith(t + "/"))) return { excluded: "outside-territory" };
  return { absolute: p };
}

// ── the layout snapshot ───────────────────────────────────────────────────────

const layout: Layout = { home: HOME, dirs: {} };

/**
 * Snapshot one directory's real children (dirs and files), if it exists. Idempotent,
 * and it upgrades a placeholder: a directory registered with an empty child list by
 * {@link snapshotSection} is refilled here when its real contents are wanted.
 */
function snapshotDir(dir: string): void {
  if (layout.dirs[dir] !== undefined && layout.dirs[dir].length > 0) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  layout.dirs[dir] = entries.sort();
}

/**
 * Snapshot `dir`, and register each of its immediate child directories as a key so
 * the renderer can tell a child that is a directory from one that is a file.
 *
 * Directory-ness comes from the single `readdir` that lists the children — `Dirent`
 * carries the type, so no per-child `stat` or `readdir` is issued. That is not just
 * an optimisation: a per-child read here blocks indefinitely when a child is a stale
 * or cloud-backed mount under the home directory, which is exactly what home has. A
 * child directory is registered with an EMPTY child list unless it is snapshotted in
 * its own right (as another section, or as a lookup's ancestor); the renderer only
 * needs the key to exist to know the child is a directory.
 */
function snapshotSection(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  layout.dirs[dir] = entries.map((e) => e.name).sort();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = `${dir}/${entry.name}`;
    if (layout.dirs[full] === undefined) layout.dirs[full] = [];
  }
}

/** Snapshot every existing ancestor directory of `abs`, up to and including home. */
function snapshotAncestors(abs: string): void {
  let cur = abs.length > 1 && abs.endsWith("/") ? abs.slice(0, -1) : abs;
  while (cur.startsWith(HOME) && cur.length >= HOME.length) {
    try {
      if (fs.statSync(cur).isDirectory()) snapshotDir(cur);
    } catch {
      // does not exist — a guessed path; its existing ancestors are found further up
    }
    if (cur === HOME) break;
    cur = cur.slice(0, cur.lastIndexOf("/")) || "/";
  }
}

// The sections the map renders, from the module so the harvest and the coverage test
// measure the same map. renderWorkspaceMap drops from the end when the budget is tight.
const SECTIONS = defaultWorkspaceSections(HOME);
for (const s of SECTIONS) snapshotSection(s.dir);

// ── the cut ───────────────────────────────────────────────────────────────────

const lookups: WorkspacePathLookup[] = [];
const excluded: Record<Exclusion, number> = {
  "not-a-path": 0,
  unnamed: 0,
  "cwd-unknown": 0,
  ephemeral: 0,
  "foreign-project": 0,
  "outside-territory": 0,
};
let pathShaped = 0;

for (const row of upstream) {
  const c = classifyFailure(row);
  if (!c) continue;
  pathShaped++;
  const r = resolve(row, c.subject);
  if ("excluded" in r) {
    excluded[r.excluded]++;
    continue;
  }
  snapshotAncestors(r.absolute);
  lookups.push({ subject: c.subject ?? "", absolute: r.absolute, session: row.session });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "lookups.json"), JSON.stringify(lookups, null, 1) + "\n");
// Keep child lists deterministic and the file diffable: sort the dir keys.
const orderedDirs: Record<string, string[]> = {};
for (const k of Object.keys(layout.dirs).sort()) orderedDirs[k] = layout.dirs[k];
fs.writeFileSync(path.join(outDir, "layout.json"), JSON.stringify({ home: HOME, dirs: orderedDirs }, null, 1) + "\n");

const meta = {
  projectsRoot,
  upstreamFailures: upstream.length,
  pathShaped,
  excluded,
  workspaceLookups: lookups.length,
  layoutDirs: Object.keys(orderedDirs).length,
};
fs.writeFileSync(path.join(outDir, "corpus.json"), JSON.stringify(meta, null, 1) + "\n");

// Render and score once here too, so the harvest prints the number it just froze.
const map = renderWorkspaceMap({ home: HOME, dirs: orderedDirs }, SECTIONS);
const census = workspaceMapCoverage(map, { home: HOME, dirs: orderedDirs }, lookups);
console.log(JSON.stringify(meta, null, 1));
console.log(`\nmap: ${census.sizeChars} chars, within budget: ${census.withinBudget}`);
console.log(`covered sections: ${map.covered.length}/${SECTIONS.length}; omitted: ${map.omitted.map((s) => s.label).join(", ") || "none"}`);
console.log(`coverage: ${census.answered}/${census.total} = ${((census.share ?? 0) * 100).toFixed(1)}% (bar 70%) → ${census.meetsBar ? "CLEARS" : "REFUTED"}`);
console.log(`\nunanswered:`);
for (const u of census.unanswered) console.log(`  ${u.subject} → needed ${u.needed.replace(HOME, "~")}`);
