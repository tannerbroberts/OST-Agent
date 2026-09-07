/**
 * Record every filesystem event of three working sessions, so the classification
 * rule in `src/runner/fs-event-classification.ts` can be scored against something
 * that actually happened rather than against an example of it.
 *
 * ## What this is, and what it is not
 *
 * It is a **reenactment**, and the corpus says so. A session here is a real
 * `fs.watch` recording of real tools — `tsc`, `vitest`, `esbuild`, `git` — running
 * against a real clone of this repository, with a genuinely separate process
 * playing the other writer. Every event in the fixture landed on a disk. What it is
 * not is three sessions somebody happened to be having: nobody was watching the
 * tree on 2026-08-03 when the merge landed on session `424486ec`, so a capture of
 * that session does not exist and cannot be made to.
 *
 * The consequence is one-directional and worth stating where the numbers are read.
 * A reenactment holds the churn its script produces and none of the churn it did
 * not think to produce — a Spotlight index pass, an editor with format-on-save
 * bound to a linter, a Dropbox daemon. That makes the corpus **easier** than a real
 * tree, never harder, so the rate measured here is a ceiling on what a watcher
 * would score in use.
 *
 * ## Ground truth is provenance, not a second opinion
 *
 * The classifier is given what a watcher could compute: the path, git's opinion of
 * it, whether the run issued the write, and the bytes of the files the run is
 * holding. It is never given the one thing this script knows for certain — which
 * process wrote the file. That is recorded from the driver's side into
 * `ground-truth.json` and is what the score is taken against.
 *
 * Usage: `npx tsx scripts/capture-fs-events.ts [--workdir DIR] [--out DIR]`
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CaptureEntry, EventTruth, FsEventEntry } from "../src/runner/fs-event-classification.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/**
 * `fs.realpathSync` is not tidiness. macOS `/tmp` and `/var` are symlinks into
 * `/private`, and FSEvents reports paths under the resolved root; watching the
 * symlinked path delivered nothing at all in one probe and a truncated prefix of
 * the events in another. The first capture taken by this script was watched
 * through `os.tmpdir()` and recorded 705 events, not one of which was a file the
 * session touched.
 */
const workRoot = fs.realpathSync(
  (() => {
    const dir = path.resolve(arg("workdir", path.join(os.tmpdir(), "ost-fs-capture")));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  })(),
);
const outDir = path.resolve(arg("out", path.join(repoRoot, "test", "fixtures", "fs-event-classification")));
const workdir = path.join(workRoot, "repo");
const actorPath = path.join(workRoot, "fs-actor.mjs");

const POLL_MS = 150;

const sha = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** The other writer, run out of the watched tree so its own file is never an event. */
const ACTOR = `
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const spec = JSON.parse(process.argv[2]);
const root = spec.root;
const at = (p) => path.join(root, p);
for (const op of spec.ops) {
  if (op.op === "append") fs.appendFileSync(at(op.file), op.text);
  else if (op.op === "rewriteIdentical") for (const f of op.files) fs.writeFileSync(at(f), fs.readFileSync(at(f)));
  else if (op.op === "scratch") for (const f of op.files) fs.writeFileSync(at(f), op.bytes ?? "scratch\\n");
  else if (op.op === "atomicSave") {
    const tmp = at(op.file + ".tmp." + op.stamp);
    fs.writeFileSync(tmp, fs.readFileSync(at(op.file)) + op.text);
    fs.renameSync(tmp, at(op.file));
  } else if (op.op === "gitCheckout") {
    const r = spawnSync("git", ["checkout", "--detach", op.ref], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  } else throw new Error("unknown op " + op.op);
}
`;

interface ExternalWindow {
  from: number;
  to: number;
  /** Paths this actor declared it would write, or `null` for "everything in the window". */
  paths: Set<string> | null;
  tag: string;
}

class SessionRecorder {
  entries: CaptureEntry[] = [];
  externals: ExternalWindow[] = [];
  private seq = 0;
  private t0 = Date.now();
  private held = new Map<string, string>();
  private watcher: fs.FSWatcher | null = null;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly root: string,
  ) {}

  private get ms() {
    return Date.now() - this.t0;
  }

  /** Last mtime+size seen for every path, so a rescan can say what moved. */
  private snapshot = new Map<string, string>();
  private poller: NodeJS.Timeout | null = null;
  /** Writes FSEvents delivered, keyed `path@mtime`, for the coverage the fixture reports. */
  readonly deliveredByWatcher = new Set<string>();
  watcherEvents = 0;
  watcherStale = 0;

  private scan(): Map<string, string> {
    const found = new Map<string, string>();
    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // removed under us mid-scan; the next pass will see it
      }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.name === "node_modules") continue; // 30k files the session never reads
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
        else if (e.isFile() || e.isSymbolicLink()) {
          try {
            const st = fs.statSync(path.join(dir, e.name));
            found.set(rel, `${Math.round(st.mtimeMs)}:${st.size}`);
          } catch {
            /* gone between readdir and stat */
          }
        }
      }
    };
    walk(this.root, "");
    return found;
  }

  private record(rel: string, kind: "change" | "rename", source: "poll" | "watch", mtimeMs: number | null) {
    let hash: string | null = null;
    if (this.held.has(rel)) {
      try {
        hash = sha(fs.readFileSync(path.join(this.root, rel)));
      } catch {
        hash = null; // renamed away, or the capture lost the race — recorded as unknown
      }
    }
    this.entries.push({
      t: "fs",
      seq: this.seq++,
      ms: this.ms,
      path: rel,
      kind,
      gitignored: false, // filled in bulk once the run is over
      hash,
      mtimeMs,
      source,
    });
  }

  /**
   * Two instruments on the same tree.
   *
   * The poller is the one the corpus is built from: every {@link POLL_MS} it walks
   * the tree and compares mtime and size, so nothing that is still on disk can be
   * missed. Node's recursive `fs.watch` runs beside it and its deliveries are
   * merged in — but only for writes that happened during the session, because on
   * this machine it also replays the tree's history: a probe watching a fresh clone
   * received 1009 events in a single flush thirteen seconds in, every one of them
   * for a file written before the watch was even opened, and none of them for the
   * five files written under it while it ran.
   */
  start() {
    this.t0 = Date.now();
    this.snapshot = this.scan();
    this.poller = setInterval(() => {
      const now = this.scan();
      for (const [rel, stamp] of now) {
        const was = this.snapshot.get(rel);
        if (was === stamp) continue;
        const mtimeMs = Number(stamp.split(":")[0]) - this.t0;
        this.record(rel, was === undefined ? "rename" : "change", "poll", Math.round(mtimeMs));
      }
      for (const rel of this.snapshot.keys()) {
        if (!now.has(rel)) this.record(rel, "rename", "poll", null);
      }
      this.snapshot = now;
    }, POLL_MS);

    this.watcher = fs.watch(this.root, { recursive: true }, (kind, filename) => {
      if (!filename) return;
      const rel = filename.split(path.sep).join("/");
      if (rel.split("/").includes("node_modules")) return;
      this.watcherEvents++;
      let mtimeMs: number | null = null;
      try {
        mtimeMs = Math.round(fs.statSync(path.join(this.root, rel)).mtimeMs - this.t0);
      } catch {
        mtimeMs = null;
      }
      // A file last written before this session started is the watcher replaying
      // history, not a write anybody made during it.
      if (mtimeMs === null || mtimeMs < 0) {
        this.watcherStale++;
        return;
      }
      this.deliveredByWatcher.add(`${rel}@${mtimeMs}`);
      // The poller sees anything still on disk. Only transient files — the scratch
      // an editor writes and removes inside one poll interval — are the watcher's
      // to contribute.
      if (fs.existsSync(path.join(this.root, rel))) return;
      this.record(rel, kind === "rename" ? "rename" : "change", "watch", mtimeMs);
    });
  }

  read(rel: string) {
    const hash = sha(fs.readFileSync(path.join(this.root, rel)));
    this.held.set(rel, hash);
    this.entries.push({ t: "read", seq: this.seq++, ms: this.ms, path: rel, hash });
  }

  selfWrite(rel: string, append: string) {
    this.entries.push({ t: "write", seq: this.seq++, ms: this.ms, path: rel });
    fs.appendFileSync(path.join(this.root, rel), append);
  }

  async run(command: string, argv: string[]) {
    const id = `c${this.seq}`;
    const line = [command, ...argv].join(" ");
    this.entries.push({ t: "cmd", seq: this.seq++, ms: this.ms, phase: "start", id, command: line });
    const code = await new Promise<number>((resolve) => {
      const child = spawn(command, argv, { cwd: this.root, stdio: "ignore" });
      child.on("close", (c) => resolve(c ?? 0));
    });
    this.entries.push({ t: "cmd", seq: this.seq++, ms: this.ms, phase: "end", id, command: line });
    return code;
  }

  /** Start a command and hand back a promise, so another writer can land inside it. */
  startRun(command: string, argv: string[]) {
    const id = `c${this.seq}`;
    const line = [command, ...argv].join(" ");
    this.entries.push({ t: "cmd", seq: this.seq++, ms: this.ms, phase: "start", id, command: line });
    const child = spawn(command, argv, { cwd: this.root, stdio: "ignore" });
    return new Promise<void>((resolve) => {
      child.on("close", () => {
        this.entries.push({ t: "cmd", seq: this.seq++, ms: this.ms, phase: "end", id, command: line });
        resolve();
      });
    });
  }

  /** Run the other writer, and record the window it wrote in as ground truth. */
  external(tag: string, paths: string[] | null, ops: unknown[]) {
    const from = this.ms;
    const r = spawnSync("node", [actorPath, JSON.stringify({ root: this.root, ops })], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`actor ${tag} failed: ${r.stderr}`);
    this.externals.push({ from, to: this.ms, paths: paths === null ? null : new Set(paths), tag });
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /** How much of what happened the watcher alone would have seen. */
  watcherCoverage() {
    const events = this.entries.filter((e): e is FsEventEntry => e.t === "fs");
    const persistent = events.filter((e) => e.source === "poll" && e.mtimeMs !== null);
    const delivered = persistent.filter((e) => this.deliveredByWatcher.has(`${e.path}@${e.mtimeMs}`));
    return {
      writes: persistent.length,
      deliveredByWatcher: delivered.length,
      watcherEventsSeen: this.watcherEvents,
      watcherEventsForOlderWrites: this.watcherStale,
    };
  }

  /** Fill in git's opinion of every path the watcher saw, in one call. */
  resolveGitignore() {
    const events = this.entries.filter((e): e is FsEventEntry => e.t === "fs");
    const candidates = [...new Set(events.map((e) => e.path))].filter((p) => !p.startsWith(".git/"));
    if (candidates.length === 0) return;
    const r = spawnSync("git", ["check-ignore", "--stdin"], {
      cwd: this.root,
      input: candidates.join("\n"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const ignored = new Set(r.stdout.split("\n").filter(Boolean));
    for (const e of events) e.gitignored = ignored.has(e.path);
  }

  /**
   * What actually happened, from the driver's side. An event is external when it
   * lands inside a window the other writer held for a path it declared; everything
   * else in the tree was written by this session or by something it started.
   */
  truth(): EventTruth[] {
    const reads = this.entries.filter((e): e is Extract<CaptureEntry, { t: "read" }> => e.t === "read");
    return this.entries
      .filter((e): e is FsEventEntry => e.t === "fs")
      .map((e) => {
        // The write time, never the delivery time: FSEvents can hand an event over
        // seconds after the fact, and attributing by arrival put writes in windows
        // whose actor had long since exited.
        const at = e.mtimeMs ?? e.ms;
        const window = this.externals.find(
          (w) => at >= w.from - 250 && at <= w.to + 250 && (w.paths === null || w.paths.has(e.path)),
        );
        const writer = window ? "external" : "session";
        const heldAt = reads.filter((r) => r.path === e.path && r.ms <= at).at(-1)?.hash;

        let label: "meaningful" | "churn" = "churn";
        let why: string;
        if (writer === "session") {
          why = "this session, or a command it started, wrote it";
        } else if (heldAt === undefined) {
          why = `${window!.tag}: the session holds no copy of this file`;
        } else if (e.hash === null) {
          why = `${window!.tag}: held file, but the bytes after the write could not be read`;
        } else if (e.hash === heldAt) {
          why = `${window!.tag}: held file rewritten with the bytes it already had`;
        } else {
          label = "meaningful";
          why = `${window!.tag}: changed a file the session had read and still holds`;
        }
        return { seq: e.seq, writer, label, why };
      });
  }
}

// ── the three sessions ──────────────────────────────────────────────────────

/** Files the sessions read. Real paths, chosen before any capture was taken. */
const HELD = {
  context: "src/runner/context.ts",
  workspace: "src/runner/workspace.ts",
  index: "src/index.ts",
  pkg: "package.json",
  readme: "README.md",
  log: "run.log",
  ruleset: "src/knowledge/ruleset.ts",
  bundle: "dist/ost-agent.mjs",
  cli: "src/cli/index.ts",
  policy: "src/security/policy.ts",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A gate run, with a teammate editing the same files while it runs. */
async function gateRun(): Promise<SessionRecorder> {
  const s = new SessionRecorder("gate-run", "a gate run while another writer edits the same tree", workdir);
  // `run.log` stands for the build loop's own log: written by the harness, read by
  // the run, and matched by `*.log` in .gitignore.
  fs.writeFileSync(path.join(workdir, "run.log"), "loop: started\n");
  s.start();
  await wait(300);

  for (const f of [HELD.context, HELD.workspace, HELD.index, HELD.pkg, HELD.readme, HELD.log]) s.read(f);

  await s.run("npx", ["tsc", "--noEmit"]);

  await wait(400);
  // The case the opportunity was written from, and the one the rule is most likely
  // to get wrong: somebody else's write landing while the run is inside a command
  // of its own. The suite is the long command in this repository, so the write goes
  // there rather than into the typecheck, which returns in about two seconds.
  const suite = s.startRun("npx", ["vitest", "run", "test/runner/context.test.ts"]);
  await wait(3000);
  s.external("teammate mid-suite", [HELD.context], [
    { op: "append", file: HELD.context, text: "\n// touched by another writer while the suite ran\n" },
  ]);
  await suite;

  await wait(400);
  // A formatter-on-save pass, over held files as well as unheld ones. The held ones
  // are rewritten with the bytes they already had, which is the case that separates
  // a watcher comparing content from one comparing mtimes.
  const formatted = [
    ...git(workdir, "ls-files", "src/adapters", "src/config", "src/git").split("\n").filter(Boolean),
    HELD.workspace,
    HELD.readme,
    HELD.index,
  ];
  s.external("formatter on save", formatted, [{ op: "rewriteIdentical", files: formatted }]);

  await wait(400);
  s.external(
    "editor scratch",
    ["src/runner/.context.ts.swp", "src/runner/4913", ".DS_Store", "src/runner/context.ts~"],
    [
      {
        op: "scratch",
        files: ["src/runner/.context.ts.swp", "src/runner/4913", ".DS_Store", "src/runner/context.ts~"],
      },
    ],
  );

  await wait(400);
  s.external("loop harness appending to its log", [HELD.log], [
    { op: "append", file: HELD.log, text: "loop: gate 1 of 2 green\n" },
  ]);

  await wait(400);
  s.external("teammate between commands", [HELD.index], [
    { op: "atomicSave", file: HELD.index, text: "// a second writer, this time between commands\n", stamp: 4711 },
  ]);

  // FSEvents can hold a batch for seconds; give the last writes time to arrive.
  await wait(3000);
  s.stop();
  return s;
}

/** A branch switch landing mid-task — the shape of session 424486ec. */
async function mergeLands(ref: string): Promise<SessionRecorder> {
  const s = new SessionRecorder("merge-lands", "a branch switch landing while the run is mid-task", workdir);
  s.start();
  await wait(300);

  const changing = git(workdir, "diff", "--name-only", "HEAD", ref).split("\n").filter(Boolean);
  for (const f of [HELD.pkg, HELD.index, HELD.policy, HELD.readme, ...changing.slice(0, 3)]) {
    if (fs.existsSync(path.join(workdir, f))) s.read(f);
  }

  await wait(400);
  await s.run("git", ["status", "--porcelain"]);

  await wait(500);
  // `null`: a checkout writes hundreds of objects under .git/ as well as the files,
  // and every one of them was written by the other process. Attributing only the
  // declared paths would have quietly credited them to this session.
  s.external("branch switch", null, [{ op: "gitCheckout", ref }]);

  await wait(800);
  s.external("teammate after the switch", [HELD.readme], [
    { op: "append", file: HELD.readme, text: "\n<!-- and one more edit after the switch -->\n" },
  ]);

  // FSEvents can hold a batch for seconds; give the last writes time to arrive.
  await wait(3000);
  s.stop();
  return s;
}

/** The build loop's own session: edit, bundle, commit, with another agent beside it. */
async function unattendedLoop(): Promise<SessionRecorder> {
  const s = new SessionRecorder("unattended-loop", "the build loop bundling and committing its own work", workdir);
  s.start();
  await wait(300);

  for (const f of [HELD.cli, HELD.bundle, HELD.pkg, HELD.ruleset, HELD.workspace]) s.read(f);

  await wait(300);
  s.selfWrite(HELD.workspace, "\n// the run's own edit\n");

  await wait(300);
  // Rewrites `dist/ost-agent.mjs`, which this session is holding — its own write,
  // arriving with nobody's name on it, three subprocesses deep.
  await s.run("npm", ["run", "bundle"]);

  await wait(500);
  s.external("another agent in the same tree", [HELD.ruleset], [
    { op: "append", file: HELD.ruleset, text: "\n// another agent, editing the ruleset\n" },
  ]);

  await wait(400);
  await s.run("git", ["add", "-A"]);
  await s.run("git", ["-c", "user.email=capture@local", "-c", "user.name=capture", "commit", "-q", "-m", "wip"]);

  await wait(400);
  s.external("scratch beside a commit", [".DS_Store", "src/.commit.tmp.9"], [
    { op: "scratch", files: [".DS_Store", "src/.commit.tmp.9"] },
  ]);

  // FSEvents can hold a batch for seconds; give the last writes time to arrive.
  await wait(3000);
  s.stop();
  return s;
}

// ── driver ──────────────────────────────────────────────────────────────────

function prepareWorkdir(pin: string) {
  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(workRoot, { recursive: true });
  fs.writeFileSync(actorPath, ACTOR);
  spawnSync("git", ["clone", "--quiet", "--local", repoRoot, workdir], { encoding: "utf8" });
  git(workdir, "checkout", "--quiet", "--detach", pin);
  // A real copy, never hard links: a test that writes into node_modules/.cache
  // would otherwise write into the repository this capture was taken from.
  const copy = spawnSync("cp", ["-Rc", path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules")]);
  if (copy.status !== 0) {
    spawnSync("cp", ["-R", path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules")]);
  }
}

async function main() {
  const pin = git(repoRoot, "rev-parse", "HEAD").trim();
  const burstRef = arg("burst-ref", "origin/gate-signal-density");
  const preregistration = arg("preregistration", git(repoRoot, "rev-parse", "be65f30").trim());

  fs.mkdirSync(outDir, { recursive: true });
  const truth: Record<string, EventTruth[]> = {};
  const summary: {
    id: string;
    label: string;
    events: number;
    external: number;
    watcherCoverage: ReturnType<SessionRecorder["watcherCoverage"]>;
  }[] = [];

  for (const scenario of [
    () => gateRun(),
    () => mergeLands(burstRef),
    () => unattendedLoop(),
  ]) {
    prepareWorkdir(pin);
    const s = await scenario();
    s.resolveGitignore();
    const jsonl = s.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(path.join(outDir, `${s.id}.jsonl`), jsonl);
    truth[s.id] = s.truth();
    const events = s.entries.filter((e) => e.t === "fs").length;
    summary.push({
      id: s.id,
      label: s.label,
      events,
      external: truth[s.id].filter((t) => t.writer === "external").length,
      watcherCoverage: s.watcherCoverage(),
    });
    const cover = summary.at(-1)!.watcherCoverage;
    console.log(
      `${s.id}: ${events} file events, ${summary.at(-1)!.external} of them external; ` +
        `fs.watch delivered ${cover.deliveredByWatcher} of ${cover.writes} writes ` +
        `(${cover.watcherEventsSeen} events seen, ${cover.watcherEventsForOlderWrites} of them for writes older than the session)`,
    );
  }

  fs.writeFileSync(
    path.join(outDir, "ground-truth.json"),
    JSON.stringify(
      {
        capturedAgainst: pin,
        preregistration,
        burstRef,
        kind: "reenactment",
        sessions: summary,
        truth,
      },
      null,
      2,
    ) + "\n",
  );
  fs.rmSync(workRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
